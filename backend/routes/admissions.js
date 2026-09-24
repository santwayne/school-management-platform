import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import pool from '../config/db.js';
import { requireAuth, requireOperator } from '../middleware/auth.js';
import { normalizePhone } from '../utils/phone.js';
import { sendTemplateMessage } from '../services/whatsappService.js';
import { audit, registerAction, raiseException } from '../services/opsService.js';
import { gradeKey, gradeLabel, classesForGrade, sendEnquiryText } from '../services/admissionAgent.js';

// ------------------------------------------------------------------
// Admissions API.
//   /api/admissions/*          operator + principal
//   /api/public/admissions/*   no auth: the school's website enquiry form
// ------------------------------------------------------------------

export const router = express.Router();
export const publicRouter = express.Router();

const STAGES = ['new', 'qualifying', 'qualified', 'visit_booked', 'visited', 'applied', 'approved', 'admitted', 'lost'];
const sendError = (res, err) => res.status(err.status || 500).json({ error: err.message });
const httpError = (status, message) => Object.assign(new Error(message), { status });

async function ownEnquiry(schoolId, id) {
  const r = await pool.query('SELECT * FROM admission_enquiries WHERE id = $1 AND school_id = $2', [id, schoolId]);
  if (!r.rowCount) throw httpError(404, 'Enquiry not found');
  return r.rows[0];
}

// ---------- Shared actions (also used as one-click inbox actions) ----------

export async function pauseAssistant(schoolId, enquiryId, hours, user) {
  const h = Math.max(0, Math.min(Number(hours) || 24, 24 * 14));
  await ownEnquiry(schoolId, enquiryId);
  await pool.query(
    `UPDATE admission_enquiries SET ai_paused_until = CASE WHEN $2::int = 0 THEN NULL ELSE NOW() + make_interval(hours => $2::int) END WHERE id = $1`,
    [enquiryId, h]
  );
  await audit({ schoolId, actorType: 'user', actorId: user?.teacher_id, action: h ? 'admission.ai_paused' : 'admission.ai_resumed', entityType: 'enquiry', entityId: enquiryId, detail: { hours: h } });
  return { paused_hours: h };
}

export async function setVisitOutcome(schoolId, visitId, status, user) {
  if (!['attended', 'no_show', 'cancelled'].includes(status)) throw httpError(400, 'status must be attended, no_show or cancelled');
  const r = await pool.query(
    `UPDATE campus_visits SET status = $3 WHERE id = $1 AND school_id = $2 AND status = 'booked' RETURNING enquiry_id, slot_id`,
    [visitId, schoolId, status]
  );
  if (!r.rowCount) throw httpError(409, 'Visit not found or already marked');
  const { enquiry_id: enquiryId, slot_id: slotId } = r.rows[0];
  if (status === 'cancelled') await pool.query('UPDATE campus_visit_slots SET booked = GREATEST(booked - 1, 0) WHERE id = $1', [slotId]);
  if (status === 'attended') {
    await pool.query(`UPDATE admission_enquiries SET stage = 'visited', updated_at = NOW() WHERE id = $1 AND stage IN ('visit_booked', 'qualified', 'qualifying')`, [enquiryId]);
  } else {
    // Back into the follow-up cycle so they get a reschedule nudge.
    await pool.query(
      `UPDATE admission_enquiries SET stage = 'qualified', next_followup_at = NOW() + INTERVAL '1 day', followup_count = 0, updated_at = NOW()
       WHERE id = $1 AND stage = 'visit_booked'`,
      [enquiryId]
    );
  }
  await audit({ schoolId, actorType: 'user', actorId: user?.teacher_id, action: `admission.visit_${status}`, entityType: 'enquiry', entityId: enquiryId, detail: { visit_id: visitId } });
  return { enquiry_id: enquiryId, status };
}

// Enquiry → parent + student, in one transaction. Reuses an existing parent
// with the same phone (siblings). WhatsApp opt-in carries over only if the
// family gave consent in the admission conversation.
export async function convertEnquiry(schoolId, enquiryId, { classId, childName } = {}, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const er = await client.query('SELECT * FROM admission_enquiries WHERE id = $1 AND school_id = $2 FOR UPDATE', [enquiryId, schoolId]);
    const e = er.rows[0];
    if (!e) throw httpError(404, 'Enquiry not found');
    if (e.converted_student_id) throw httpError(409, 'Already admitted');
    const name = (childName || e.child_name || '').trim();
    if (!name) throw httpError(400, "Child's name is required before admitting");

    let cls = null;
    if (classId) {
      const c = await client.query('SELECT id, name, section, seat_capacity FROM classes WHERE id = $1 AND school_id = $2', [classId, schoolId]);
      cls = c.rows[0];
      if (!cls) throw httpError(400, 'Class not found');
    } else if (e.applying_grade) {
      const matches = await classesForGrade(schoolId, e.applying_grade);
      if (matches.length === 1) cls = matches[0];
      else if (matches.length > 1) throw httpError(400, `Choose a section: ${matches.map((m) => `${m.name}${m.section ? ` ${m.section}` : ''}`).join(', ')}`);
    }
    if (!cls) throw httpError(400, 'Choose the class to admit into');

    if (cls.seat_capacity !== null && cls.seat_capacity !== undefined) {
      const n = await client.query('SELECT COUNT(*)::int AS n FROM students WHERE class_id = $1', [cls.id]);
      if (n.rows[0].n >= cls.seat_capacity) throw httpError(409, `${cls.name}${cls.section ? ` ${cls.section}` : ''} is full (${cls.seat_capacity} seats)`);
    }

    const existingParent = await client.query('SELECT id FROM parents WHERE school_id = $1 AND phone = $2 LIMIT 1', [schoolId, e.phone]);
    let parentId = existingParent.rows[0]?.id;
    if (!parentId) {
      const p = await client.query(
        `INSERT INTO parents (school_id, name, phone, preferred_language, opt_in_status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [schoolId, e.parent_name || 'Parent', e.phone, ['hi', 'pa', 'en'].includes(e.convo_state?.lang) ? e.convo_state.lang : 'hi', e.whatsapp_consent && !e.opted_out ? 'OPTED_IN' : 'OPTED_OUT']
      );
      parentId = p.rows[0].id;
    }
    const s = await client.query(`INSERT INTO students (school_id, class_id, parent_id, name) VALUES ($1, $2, $3, $4) RETURNING id`, [schoolId, cls.id, parentId, name]);
    await client.query(
      `UPDATE admission_enquiries SET stage = 'admitted', converted_student_id = $2, next_followup_at = NULL, updated_at = NOW() WHERE id = $1`,
      [enquiryId, s.rows[0].id]
    );
    await client.query('COMMIT');
    await audit({ schoolId, actorType: 'user', actorId: user?.teacher_id, action: 'admission.admitted', entityType: 'student', entityId: s.rows[0].id, detail: { enquiry_id: enquiryId, class_id: cls.id } });
    return { student_id: s.rows[0].id, parent_id: parentId, class_id: cls.id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

registerAction('admission.pause_ai', ({ params, user }) => pauseAssistant(user.school_id, params.enquiry_id, params.hours ?? 24, user));
registerAction('admission.visit_attended', ({ params, user }) => setVisitOutcome(user.school_id, params.visit_id, 'attended', user));

// ---------- Operator routes ----------

router.use(requireAuth, requireOperator);

router.get('/enquiries', async (req, res) => {
  const { stage, q } = req.query;
  const params = [req.user.school_id];
  const where = ['e.school_id = $1'];
  if (stage === 'active') where.push(`e.stage NOT IN ('admitted', 'lost')`);
  else if (stage && STAGES.includes(stage)) {
    params.push(stage);
    where.push(`e.stage = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(e.parent_name ILIKE $${params.length} OR e.child_name ILIKE $${params.length} OR e.phone ILIKE $${params.length})`);
  }
  try {
    const r = await pool.query(
      `SELECT e.id, e.source, e.phone, e.parent_name, e.child_name, e.applying_grade, e.applying_class_text, e.locality, e.needs_transport,
              e.stage, e.lost_reason, e.opted_out, e.ai_paused_until, e.last_inbound_at, e.followup_count, e.created_at, e.updated_at,
              v.slot_start AS visit_at, v.visit_status, v.visit_id
       FROM admission_enquiries e
       LEFT JOIN LATERAL (
         SELECT cs.slot_start, cv.status AS visit_status, cv.id AS visit_id FROM campus_visits cv JOIN campus_visit_slots cs ON cs.id = cv.slot_id
         WHERE cv.enquiry_id = e.id ORDER BY cv.id DESC LIMIT 1
       ) v ON TRUE
       WHERE ${where.join(' AND ')}
       ORDER BY e.updated_at DESC LIMIT 500`,
      params
    );
    const counts = await pool.query(`SELECT stage, COUNT(*)::int AS n FROM admission_enquiries WHERE school_id = $1 GROUP BY stage`, [req.user.school_id]);
    res.json({ items: r.rows.map((row) => ({ ...row, applying_class_label: gradeLabel(row.applying_grade) })), counts: Object.fromEntries(counts.rows.map((c) => [c.stage, c.n])) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/enquiries/:id', async (req, res) => {
  try {
    const e = await ownEnquiry(req.user.school_id, req.params.id);
    const [messages, visits, matchingClasses] = await Promise.all([
      pool.query('SELECT id, direction, body, template_name, sent_by, delivery_status, created_at FROM enquiry_messages WHERE enquiry_id = $1 ORDER BY id', [e.id]),
      pool.query(
        `SELECT cv.id, cv.status, cs.slot_start, cs.slot_end FROM campus_visits cv JOIN campus_visit_slots cs ON cs.id = cv.slot_id WHERE cv.enquiry_id = $1 ORDER BY cv.id DESC`,
        [e.id]
      ),
      e.applying_grade ? classesForGrade(req.user.school_id, e.applying_grade) : Promise.resolve([]),
    ]);
    const windowOpen = e.last_inbound_at && Date.now() - new Date(e.last_inbound_at) < 24 * 3600 * 1000;
    res.json({ ...e, applying_class_label: gradeLabel(e.applying_grade), messages: messages.rows, visits: visits.rows, matching_classes: matchingClasses, can_reply: !!windowOpen && !e.opted_out });
  } catch (err) {
    sendError(res, err);
  }
});

// Walk-in / phone enquiry entered by the operator.
router.post('/enquiries', async (req, res) => {
  const { phone, parent_name, child_name, applying_class, locality, needs_transport, notes, source = 'walk_in' } = req.body || {};
  const e164 = normalizePhone(phone);
  if (!e164) return res.status(400).json({ error: 'A valid mobile number is required' });
  if (!['walk_in', 'phone', 'web_form', 'meta_lead'].includes(source)) return res.status(400).json({ error: 'invalid source' });
  try {
    const r = await pool.query(
      `INSERT INTO admission_enquiries (school_id, source, phone, parent_name, child_name, applying_class_text, applying_grade, locality, needs_transport, notes, stage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'qualifying') RETURNING *`,
      [req.user.school_id, source, e164, parent_name || null, child_name || null, applying_class || null, gradeKey(applying_class), locality || null, typeof needs_transport === 'boolean' ? needs_transport : null, notes || null]
    );
    await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'admission.enquiry_created', entityType: 'enquiry', entityId: r.rows[0].id, detail: { source } });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'There is already an open enquiry for this number' });
    sendError(res, err);
  }
});

router.patch('/enquiries/:id', async (req, res) => {
  const allowed = ['parent_name', 'child_name', 'locality', 'needs_transport', 'notes', 'stage', 'lost_reason', 'email', 'child_dob'];
  const body = req.body || {};
  const sets = [];
  const params = [req.params.id, req.user.school_id];
  for (const k of allowed) {
    if (!(k in body)) continue;
    if (k === 'stage' && !STAGES.includes(body.stage)) return res.status(400).json({ error: 'invalid stage' });
    if (k === 'stage' && body.stage === 'admitted') return res.status(400).json({ error: 'Use "Admit" to convert an enquiry into a student' });
    params.push(body[k]);
    sets.push(`${k} = $${params.length}`);
  }
  if ('applying_class' in body) {
    params.push(body.applying_class, gradeKey(body.applying_class));
    sets.push(`applying_class_text = $${params.length - 1}`, `applying_grade = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  if (body.stage === 'lost') sets.push('next_followup_at = NULL');
  try {
    const r = await pool.query(`UPDATE admission_enquiries SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 AND school_id = $2 RETURNING *`, params);
    if (!r.rowCount) return res.status(404).json({ error: 'Enquiry not found' });
    await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'admission.enquiry_updated', entityType: 'enquiry', entityId: r.rows[0].id, detail: { fields: Object.keys(body) } });
    res.json(r.rows[0]);
  } catch (err) {
    sendError(res, err);
  }
});

// Staff reply. Free text is only allowed inside WhatsApp's 24 h window
// after the parent's last message; outside it Meta requires a template.
router.post('/enquiries/:id/reply', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  try {
    const e = await ownEnquiry(req.user.school_id, req.params.id);
    if (e.opted_out) return res.status(409).json({ error: 'This family opted out of WhatsApp messages. Call them instead.' });
    if (!e.last_inbound_at || Date.now() - new Date(e.last_inbound_at) > 24 * 3600 * 1000) {
      return res.status(409).json({ error: "WhatsApp only allows free replies within 24 hours of the family's last message. Call them, or wait for the automatic follow-up." });
    }
    const ok = await sendEnquiryText(e, text, { sentBy: 'staff' });
    // A human replying means they're handling it: pause the assistant.
    await pauseAssistant(req.user.school_id, e.id, 24, req.user);
    res.json({ ok, delivered: ok });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/enquiries/:id/pause', async (req, res) => {
  try {
    res.json(await pauseAssistant(req.user.school_id, req.params.id, req.body?.hours ?? 24, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/enquiries/:id/convert', async (req, res) => {
  try {
    res.json(await convertEnquiry(req.user.school_id, Number(req.params.id), { classId: req.body?.class_id, childName: req.body?.child_name }, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/visits/:id/outcome', async (req, res) => {
  try {
    res.json(await setVisitOutcome(req.user.school_id, Number(req.params.id), req.body?.status, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

// Funnel for the principal: last N days.
router.get('/stats', async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS enquiries,
              COUNT(*) FILTER (WHERE stage NOT IN ('new', 'qualifying', 'lost'))::int AS qualified,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM campus_visits v WHERE v.enquiry_id = e.id))::int AS visits_booked,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM campus_visits v WHERE v.enquiry_id = e.id AND v.status = 'attended'))::int AS visited,
              COUNT(*) FILTER (WHERE stage = 'admitted')::int AS admitted,
              COUNT(*) FILTER (WHERE stage = 'lost')::int AS lost
       FROM admission_enquiries e WHERE school_id = $1 AND created_at > NOW() - make_interval(days => $2::int)`,
      [req.user.school_id, days]
    );
    const bySource = await pool.query(
      `SELECT source, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE stage = 'admitted')::int AS admitted
       FROM admission_enquiries WHERE school_id = $1 AND created_at > NOW() - make_interval(days => $2::int) GROUP BY source`,
      [req.user.school_id, days]
    );
    const lostReasons = await pool.query(
      `SELECT COALESCE(lost_reason, 'unknown') AS reason, COUNT(*)::int AS n FROM admission_enquiries
       WHERE school_id = $1 AND stage = 'lost' AND created_at > NOW() - make_interval(days => $2::int) GROUP BY 1 ORDER BY n DESC`,
      [req.user.school_id, days]
    );
    res.json({ days, funnel: r.rows[0], by_source: bySource.rows, lost_reasons: lostReasons.rows });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------- Visit slots ----------

router.get('/slots', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, slot_start, slot_end, capacity, booked FROM campus_visit_slots
       WHERE school_id = $1 AND slot_end > (NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '1 day' ORDER BY slot_start`,
      [req.user.school_id]
    );
    res.json(r.rows);
  } catch (err) {
    sendError(res, err);
  }
});

// Create a batch: { dates: ['2026-10-01', ...], times: ['10:00', '11:30'], duration_minutes: 30, capacity: 3 }
router.post('/slots', async (req, res) => {
  const { dates, times, duration_minutes = 30, capacity = 3 } = req.body || {};
  const dateOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const timeOk = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (!Array.isArray(dates) || !dates.length || !dates.every(dateOk)) return res.status(400).json({ error: 'dates must be YYYY-MM-DD strings' });
  if (!Array.isArray(times) || !times.length || !times.every(timeOk)) return res.status(400).json({ error: 'times must be HH:MM strings' });
  if (dates.length * times.length > 200) return res.status(400).json({ error: 'Too many slots at once (max 200)' });
  const dur = Math.max(10, Math.min(Number(duration_minutes) || 30, 240));
  const cap = Math.max(1, Math.min(Number(capacity) || 3, 50));
  try {
    let created = 0;
    for (const d of dates) {
      for (const t of times) {
        const r = await pool.query(
          `INSERT INTO campus_visit_slots (school_id, slot_start, slot_end, capacity)
           VALUES ($1, ($2 || ' ' || $3)::timestamp, ($2 || ' ' || $3)::timestamp + make_interval(mins => $4::int), $5)
           ON CONFLICT (school_id, slot_start) DO NOTHING`,
          [req.user.school_id, d, t, dur, cap]
        );
        created += r.rowCount;
      }
    }
    res.status(201).json({ created });
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/slots/:id', async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM campus_visit_slots WHERE id = $1 AND school_id = $2 AND booked = 0 RETURNING id`, [req.params.id, req.user.school_id]);
    if (!r.rowCount) return res.status(409).json({ error: 'Slot not found or already has bookings' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------- Knowledge base & settings ----------

const KB_TOPICS = ['timings', 'board', 'facilities', 'transport_areas', 'admission_process', 'documents_required', 'address', 'custom'];

router.get('/knowledge-base', async (req, res) => {
  try {
    const r = await pool.query('SELECT topic, answer, audience, updated_at FROM school_knowledge_base WHERE school_id = $1 ORDER BY topic', [req.user.school_id]);
    res.json({ topics: KB_TOPICS, items: r.rows });
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/knowledge-base', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  try {
    for (const it of items) {
      if (!KB_TOPICS.includes(it.topic)) continue;
      const answer = String(it.answer || '').trim().slice(0, 2000);
      if (!answer) {
        await pool.query('DELETE FROM school_knowledge_base WHERE school_id = $1 AND topic = $2', [req.user.school_id, it.topic]);
        continue;
      }
      await pool.query(
        `INSERT INTO school_knowledge_base (school_id, topic, answer, audience) VALUES ($1,$2,$3,$4)
         ON CONFLICT (school_id, topic) DO UPDATE SET answer = EXCLUDED.answer, audience = EXCLUDED.audience, updated_at = NOW()`,
        [req.user.school_id, it.topic, answer, ['enquiry', 'parent', 'all'].includes(it.audience) ? it.audience : 'all']
      );
    }
    await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'admission.kb_updated' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/settings', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT admission_code, public_slug, COALESCE(admissions_open, TRUE) AS admissions_open, COALESCE(admission_followup_days, '1,3,7') AS admission_followup_days, whatsapp_phone_number_id
       FROM school_settings WHERE school_id = $1`,
      [req.user.school_id]
    );
    const s = r.rows[0] || {};
    const waNumber = process.env.WHATSAPP_DISPLAY_NUMBER || '';
    res.json({
      ...s,
      // Link to put on the school's website: opens WhatsApp with the school's
      // code pre-filled, so the platform knows which school the parent means.
      whatsapp_link: waNumber && s.admission_code ? `https://wa.me/${waNumber.replace(/\D/g, '')}?text=${encodeURIComponent(`Admission enquiry ${s.admission_code}`)}` : null,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/settings', async (req, res) => {
  const { admission_code, public_slug, admissions_open, admission_followup_days } = req.body || {};
  if (admission_code && !/^[A-Za-z0-9]{3,12}$/.test(admission_code)) return res.status(400).json({ error: 'Admission code must be 3–12 letters/numbers' });
  if (public_slug && !/^[a-z0-9-]{3,60}$/.test(public_slug)) return res.status(400).json({ error: 'Web address must be 3–60 lowercase letters, numbers or dashes' });
  if (admission_followup_days && !/^\d{1,2}(,\d{1,2}){0,5}$/.test(admission_followup_days)) return res.status(400).json({ error: 'Follow-up days must look like 1,3,7' });
  try {
    await pool.query(
      `INSERT INTO school_settings (school_id, admission_code, public_slug, admissions_open, admission_followup_days)
       VALUES ($1, $2, $3, COALESCE($4, TRUE), COALESCE($5, '1,3,7'))
       ON CONFLICT (school_id) DO UPDATE SET admission_code = EXCLUDED.admission_code, public_slug = EXCLUDED.public_slug,
         admissions_open = EXCLUDED.admissions_open, admission_followup_days = EXCLUDED.admission_followup_days, updated_at = NOW()`,
      [req.user.school_id, admission_code ? admission_code.toUpperCase() : null, public_slug || null, typeof admissions_open === 'boolean' ? admissions_open : null, admission_followup_days || null]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That admission code or web address is already used by another school' });
    sendError(res, err);
  }
});

// ---------- Public (no auth) ----------

const publicLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

async function schoolBySlug(slug) {
  const r = await pool.query(
    `SELECT s.id, s.name, COALESCE(ss.admissions_open, TRUE) AS admissions_open FROM school_settings ss JOIN schools s ON s.id = ss.school_id
     WHERE ss.public_slug = $1 AND s.status = 'active'`,
    [slug]
  );
  return r.rows[0] || null;
}

publicRouter.get('/:slug', async (req, res) => {
  try {
    const s = await schoolBySlug(req.params.slug);
    if (!s) return res.status(404).json({ error: 'School not found' });
    const classes = await pool.query('SELECT DISTINCT name FROM classes WHERE school_id = $1', [s.id]);
    const grades = [...new Set(classes.rows.map((c) => gradeKey(c.name)).filter(Boolean))];
    res.json({ name: s.name, admissions_open: s.admissions_open, grades: grades.map((g) => ({ key: g, label: gradeLabel(g) })) });
  } catch (err) {
    sendError(res, err);
  }
});

publicRouter.post('/:slug/enquiry', publicLimiter, async (req, res) => {
  const { parent_name, phone, child_name, applying_class, consent, website } = req.body || {};
  if (website) return res.status(201).json({ ok: true }); // honeypot: bots fill hidden fields
  const e164 = normalizePhone(phone);
  if (!e164) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
  if (!parent_name || !String(parent_name).trim()) return res.status(400).json({ error: 'Please enter your name' });
  if (consent !== true) return res.status(400).json({ error: 'Please agree to be contacted on WhatsApp' });
  try {
    const s = await schoolBySlug(req.params.slug);
    if (!s) return res.status(404).json({ error: 'School not found' });
    if (!s.admissions_open) return res.status(409).json({ error: 'Admissions are closed at the moment' });
    const r = await pool.query(
      `INSERT INTO admission_enquiries (school_id, source, phone, parent_name, child_name, applying_class_text, applying_grade, whatsapp_consent, consent_at, stage, next_followup_at)
       VALUES ($1, 'web_form', $2, $3, $4, $5, $6, TRUE, NOW(), 'qualifying', NOW() + INTERVAL '1 day')
       ON CONFLICT (school_id, phone) WHERE stage NOT IN ('admitted', 'lost')
       DO UPDATE SET parent_name = COALESCE(admission_enquiries.parent_name, EXCLUDED.parent_name),
                     child_name = COALESCE(admission_enquiries.child_name, EXCLUDED.child_name),
                     applying_class_text = COALESCE(admission_enquiries.applying_class_text, EXCLUDED.applying_class_text),
                     applying_grade = COALESCE(admission_enquiries.applying_grade, EXCLUDED.applying_grade),
                     whatsapp_consent = TRUE, consent_at = NOW(), updated_at = NOW()
       RETURNING *`,
      [s.id, e164, String(parent_name).trim().slice(0, 150), child_name ? String(child_name).trim().slice(0, 150) : null, applying_class || null, gradeKey(applying_class)]
    );
    const e = r.rows[0];
    // First message to someone who hasn't written to us must be a template.
    //   admission_welcome  {{1}} parent name, {{2}} school name
    //   "Hi {{1}}, thank you for your admission enquiry at {{2}}! Reply here to ask about fees, book a campus visit, or anything else."
    let whatsapp = 'sent';
    try {
      await sendTemplateMessage(e164.replace(/^\+/, ''), process.env.WHATSAPP_ADMISSION_WELCOME_TEMPLATE || 'admission_welcome', 'en', [e.parent_name || 'there', s.name]);
      await pool.query(
        `INSERT INTO enquiry_messages (school_id, enquiry_id, direction, body, template_name, sent_by, delivery_status) VALUES ($1,$2,'out','[Welcome message]','admission_welcome','system','sent')`,
        [s.id, e.id]
      );
    } catch (err) {
      whatsapp = 'failed';
      await raiseException({
        schoolId: s.id,
        source: 'admission',
        severity: 'medium',
        title: `New web enquiry, but the WhatsApp welcome failed (${e.parent_name})`,
        body: `Call ${e164} to follow up. WhatsApp error: ${err.response?.data?.error?.message || err.message}`,
        entityType: 'enquiry',
        entityId: e.id,
        dedupeKey: `welcome_failed:${e.id}`,
      });
    }
    await audit({ schoolId: s.id, action: 'admission.enquiry_created', entityType: 'enquiry', entityId: e.id, detail: { source: 'web_form', whatsapp } });
    res.status(201).json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
