import pool from '../config/db.js';
import { isoWeekLabel, istToday, istHour, noteLanguage, LANGUAGE_NAMES, fallbackNote, hasWeekFacts, noteProblems, toTemplateParam } from '../utils/aiAutomation.js';
import { askJSON, makeBudget } from './aiText.js';
import { raiseException, audit } from './opsService.js';
import { sendTemplateMessage } from './whatsappService.js';
import { sendWithLanguageFallback, parentTemplateLanguage } from '../utils/templateLanguage.js';
import { AI_SCHOOLS_SQL } from './schoolPlans.js';

// A2 — a short personal weekly note to each parent, in their language.
//
// Sunday night: drafts are written from the week's facts (attendance,
// homework, published marks) and the AI tutor's learning profile. Nothing is
// sent until a class teacher or the principal approves it on the approval
// screen (they can edit any note). Approved notes go out between 8 AM and
// 8 PM India time. Only parents who are opted in to WhatsApp AND have given
// consent for AI-written learning notes (or not declined, if the school
// chose opt-out consent) get a draft at all.

const AI_CALLS_PER_SCHOOL = Number(process.env.PROGRESS_NOTES_AI_LIMIT) || 400;
const DRAFT_TTL_DAYS = 4;
const SEND_WINDOW = { from: 8, to: 20 }; // IST hours
const firstName = (n) => String(n || '').trim().split(/\s+/)[0];

export class NotesError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function notesSettings(schoolId) {
  const r = await pool.query(
    `SELECT COALESCE(progress_notes_enabled, FALSE) AS enabled, COALESCE(progress_notes_consent_mode, 'explicit') AS consent_mode,
            COALESCE(progress_notes_approver, 'class_teacher') AS approver, COALESCE(progress_notes_language, 'parent') AS language
       FROM school_settings WHERE school_id = $1`,
    [schoolId]
  );
  return r.rows[0] || { enabled: false, consent_mode: 'explicit', approver: 'class_teacher', language: 'parent' };
}

const consentSql = (mode) => (mode === 'opt_out' ? `p.ai_notes_consent <> 'declined'` : `p.ai_notes_consent = 'granted'`);

async function weekFacts(schoolId, studentIds, from, to) {
  const [att, hw, marks, learning, obs] = await Promise.all([
    pool.query(
      `SELECT student_id, COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS present, COUNT(*)::int AS total
         FROM attendance WHERE school_id = $1 AND student_id = ANY($2::int[]) AND date BETWEEN $3 AND $4 GROUP BY student_id`,
      [schoolId, studentIds, from, to]
    ),
    pool.query(
      `SELECT s.id AS student_id, COUNT(DISTINCT h.id)::int AS assigned, COUNT(DISTINCT hc.homework_id)::int AS completed
         FROM students s JOIN homework h ON h.class_id = s.class_id AND h.shared_at IS NOT NULL AND h.shared_at::date BETWEEN $3 AND $4
         LEFT JOIN homework_completions hc ON hc.homework_id = h.id AND hc.student_id = s.id
        WHERE s.school_id = $1 AND s.id = ANY($2::int[]) GROUP BY s.id`,
      [schoolId, studentIds, from, to]
    ),
    // Only results the school has already published to families.
    pool.query(
      `SELECT m.student_id, sub.name AS subject, ROUND(100.0 * m.marks_obtained / NULLIF(m.max_marks, 0))::int AS percent
         FROM exam_marks m JOIN exams e ON e.id = m.exam_id JOIN subjects sub ON sub.id = m.subject_id
        WHERE m.school_id = $1 AND m.student_id = ANY($2::int[]) AND e.result_published_at IS NOT NULL
          AND e.result_published_at::date BETWEEN $3 AND $4`,
      [schoolId, studentIds, from, to]
    ),
    pool.query(
      `SELECT student_id, strengths, struggles, interests, next_steps FROM student_learning_profiles WHERE school_id = $1 AND student_id = ANY($2::int[])`,
      [schoolId, studentIds]
    ),
    pool.query(
      `SELECT student_id, note FROM student_observations
        WHERE school_id = $1 AND student_id = ANY($2::int[]) AND visible_to_student = TRUE AND created_at::date BETWEEN $3 AND $4
        ORDER BY created_at DESC`,
      [schoolId, studentIds, from, to]
    ),
  ]);
  const out = new Map(studentIds.map((id) => [id, { marks_week: [], teacher_notes: [] }]));
  for (const r of att.rows) out.get(r.student_id).attendance_week = { present: r.present, total: r.total };
  for (const r of hw.rows) out.get(r.student_id).homework_week = { assigned: r.assigned, completed: r.completed };
  for (const r of marks.rows) out.get(r.student_id).marks_week.push({ subject: r.subject, percent: r.percent });
  for (const r of learning.rows) {
    Object.assign(out.get(r.student_id), {
      strengths: (r.strengths || []).slice(0, 3),
      finds_difficult: (r.struggles || []).slice(0, 2),
      interests: (r.interests || []).slice(0, 3),
      next_steps: (r.next_steps || []).slice(0, 2),
    });
  }
  for (const r of obs.rows) {
    const f = out.get(r.student_id);
    if (f.teacher_notes.length < 2) f.teacher_notes.push(String(r.note).slice(0, 200));
  }
  return out;
}

async function writeNote(facts, language, budget) {
  const fallback = fallbackNote(facts, language);
  const out = await askJSON({
    budget,
    maxTokens: 500,
    system:
      `You write a short weekly note from a school to a parent about their child, in ${LANGUAGE_NAMES[language] || LANGUAGE_NAMES.en}. ` +
      'Return {"note":"3 or 4 short sentences, max 450 characters, one paragraph"}. ' +
      'Rules: start with something genuinely positive from the facts; mention at most one thing to work on, kindly and specifically; ' +
      'end with ONE small thing the parent can do at home this week (about 10 minutes), taken from next_steps or finds_difficult when available. ' +
      'Use ONLY the facts given — never invent marks, events or reasons. Never use labels such as weak, lazy, slow or poor, never compare with other children, ' +
      'and never mention family, health, behaviour or fees. Refer to the child by first name. No greetings, sign-off, emojis, links or line breaks.',
    payload: facts,
  });
  const note = toTemplateParam(out?.note || '', 700);
  if (note && !noteProblems(note).length) return { note, by: 'ai' };
  return fallback ? { note: toTemplateParam(fallback, 700), by: 'rules' } : null;
}

export async function draftNotesForSchool(schoolId, { today = istToday() } = {}) {
  const settings = await notesSettings(schoolId);
  if (!settings.enabled) return { skipped: 'disabled', drafted: 0 };
  const period = isoWeekLabel(today);
  const from = (await pool.query(`SELECT ($1::date - 6)::text AS d`, [today])).rows[0].d;

  await pool.query(
    `UPDATE parent_progress_notes SET status = 'expired' WHERE school_id = $1 AND status = 'draft' AND created_at < NOW() - make_interval(days => $2)`,
    [schoolId, DRAFT_TTL_DAYS]
  );
  // Close inbox items for weeks that no longer have anything to approve.
  await pool.query(
    `UPDATE ops_exceptions e SET status = 'resolved', resolved_at = NOW(), resolution_note = 'No drafts left for this week'
      WHERE e.school_id = $1 AND e.dedupe_key LIKE 'progress_notes:%' AND e.status IN ('open', 'snoozed')
        AND NOT EXISTS (SELECT 1 FROM parent_progress_notes n WHERE n.school_id = e.school_id AND n.status = 'draft'
                         AND n.period = substring(e.dedupe_key FROM 16))`,
    [schoolId]
  );

  const eligible = await pool.query(
    `SELECT s.id, s.name, s.class_id, c.name AS class_name, p.id AS parent_id, p.preferred_language
       FROM students s JOIN classes c ON c.id = s.class_id JOIN parents p ON p.id = s.parent_id
      WHERE s.school_id = $1 AND COALESCE(s.is_demo, FALSE) = FALSE AND p.opt_in_status = 'OPTED_IN' AND ${consentSql(settings.consent_mode)}
        AND NOT EXISTS (SELECT 1 FROM parent_progress_notes n WHERE n.student_id = s.id AND n.period = $2)`,
    [schoolId, period]
  );
  if (!eligible.rowCount) return { period, drafted: 0, eligible: 0 };

  const facts = await weekFacts(schoolId, eligible.rows.map((s) => s.id), from, today);
  const budget = makeBudget(AI_CALLS_PER_SCHOOL);
  let drafted = 0;
  let nothing = 0;
  for (const s of eligible.rows) {
    const f = { first_name: firstName(s.name), class: s.class_name, week: `${from} to ${today}`, ...facts.get(s.id) };
    if (!hasWeekFacts(f)) {
      nothing += 1;
      continue;
    }
    const language = noteLanguage(settings.language, s.preferred_language);
    const written = await writeNote(f, language, budget);
    if (!written) {
      nothing += 1;
      continue;
    }
    const ins = await pool.query(
      `INSERT INTO parent_progress_notes (school_id, student_id, class_id, parent_id, period, language, note, facts, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (student_id, period) DO NOTHING RETURNING id`,
      [schoolId, s.id, s.class_id, s.parent_id, period, language, written.note, JSON.stringify(f), written.by]
    );
    drafted += ins.rowCount;
  }

  if (drafted) {
    await raiseException({
      schoolId,
      source: 'progress_notes',
      severity: 'low',
      title: `${drafted} parent progress note${drafted === 1 ? '' : 's'} ready to approve`,
      body: `Nothing is sent until a ${settings.approver === 'principal' ? 'principal or operator' : 'class teacher or the principal'} approves. Open Control Center → Parent notes. Drafts expire after ${DRAFT_TTL_DAYS} days.`,
      entityType: 'progress_notes_week',
      dedupeKey: `progress_notes:${period}`,
    });
    if (settings.approver === 'class_teacher') {
      const teachers = await pool.query(
        `SELECT c.class_teacher_id AS id, c.name, COUNT(*)::int AS n FROM parent_progress_notes n JOIN classes c ON c.id = n.class_id
          WHERE n.school_id = $1 AND n.period = $2 AND n.status = 'draft' AND c.class_teacher_id IS NOT NULL GROUP BY c.class_teacher_id, c.name`,
        [schoolId, period]
      );
      for (const t of teachers.rows) {
        await pool.query(
          `INSERT INTO dashboard_notifications (school_id, trigger_event, recipient_type, recipient_id, channel_used, title, body, link)
           VALUES ($1, 'progress_notes_ready', 'staff', $2, 'dashboard', $3, 'Read, edit if needed, and approve before they go to parents on WhatsApp.', '/teacher/progress-notes')`,
          [schoolId, t.id, `${t.n} parent note${t.n === 1 ? '' : 's'} for ${t.name} to approve`]
        );
      }
    }
  }
  await audit({ schoolId, action: 'ai.progress_notes_drafted', detail: { period, eligible: eligible.rowCount, drafted, no_activity: nothing } });
  return { period, eligible: eligible.rowCount, drafted, no_activity: nothing };
}

export async function runDraftNotes() {
  const schools = await pool.query(
    `SELECT s.id FROM schools s JOIN school_settings ss ON ss.school_id = s.id WHERE s.status = 'active' AND ss.progress_notes_enabled = TRUE AND ${AI_SCHOOLS_SQL}`
  );
  let processed = 0;
  let failed = 0;
  let drafted = 0;
  for (const s of schools.rows) {
    try {
      drafted += (await draftNotesForSchool(s.id)).drafted || 0;
      processed += 1;
    } catch (err) {
      failed += 1;
      console.error(`[progress notes] drafting failed for school ${s.id}:`, err.message);
    }
  }
  return { processed, failed, drafted };
}

// ---------- approval ----------

// Who may approve a note: principal/operator always; a class teacher for
// their own class unless the school set approval to principal-only.
export async function approvalScope(user) {
  if (['principal', 'operator'].includes(user.role)) return { all: true };
  if (user.role !== 'teacher') throw new NotesError(403, 'Only staff can see parent notes.');
  const settings = await notesSettings(user.school_id);
  const classes = await pool.query('SELECT id FROM classes WHERE school_id = $1 AND class_teacher_id = $2', [user.school_id, user.teacher_id]);
  return { all: false, classIds: classes.rows.map((c) => c.id), canApprove: settings.approver === 'class_teacher' };
}

export async function listNotes(user, { period, status, classId } = {}) {
  const scope = await approvalScope(user);
  if (!scope.all && !scope.classIds.length) return { period: null, notes: [], can_approve: false, periods: [] };
  const periods = await pool.query(
    `SELECT period, COUNT(*)::int AS n FROM parent_progress_notes WHERE school_id = $1 AND ($2::boolean OR class_id = ANY($3::int[]))
      GROUP BY period ORDER BY period DESC LIMIT 8`,
    [user.school_id, scope.all, scope.classIds || []]
  );
  const p = period || periods.rows[0]?.period || null;
  const { rows } = await pool.query(
    `SELECT n.id, n.student_id, s.name AS student_name, c.name AS class_name, n.class_id, n.language, n.note, n.facts, n.generated_by, n.edited,
            n.status, n.error, n.approved_at, n.sent_at, t.name AS approved_by_name, p.name AS parent_name
       FROM parent_progress_notes n JOIN students s ON s.id = n.student_id LEFT JOIN classes c ON c.id = n.class_id
       LEFT JOIN teachers t ON t.id = n.approved_by LEFT JOIN parents p ON p.id = n.parent_id
      WHERE n.school_id = $1 AND n.period = $2 AND ($3::boolean OR n.class_id = ANY($4::int[]))
        AND ($5::text IS NULL OR n.status = $5) AND ($6::int IS NULL OR n.class_id = $6)
      ORDER BY c.name, s.name`,
    [user.school_id, p, scope.all, scope.classIds || [], status || null, classId || null]
  );
  return { period: p, periods: periods.rows, notes: rows, can_approve: scope.all || scope.canApprove };
}

async function claimEditable(user, ids) {
  const scope = await approvalScope(user);
  if (!scope.all && !scope.canApprove) throw new NotesError(403, 'At this school only the principal approves parent notes.');
  const list = [...new Set((ids || []).map(Number).filter(Number.isInteger))].slice(0, 500);
  if (!list.length) throw new NotesError(400, 'Pick at least one note.');
  const { rows } = await pool.query(
    `SELECT id FROM parent_progress_notes WHERE school_id = $1 AND id = ANY($2::int[]) AND status = 'draft' AND ($3::boolean OR class_id = ANY($4::int[]))`,
    [user.school_id, list, scope.all, scope.classIds || []]
  );
  return rows.map((r) => r.id);
}

export async function editNote(user, id, text) {
  const note = toTemplateParam(text, 700);
  const problems = noteProblems(note);
  if (problems.includes('empty')) throw new NotesError(400, 'The note cannot be empty.');
  if (problems.includes('too_long')) throw new NotesError(400, 'Please keep the note under 700 characters.');
  if (problems.some((p) => p.startsWith('label:'))) throw new NotesError(400, `Please avoid labels like "${problems.find((p) => p.startsWith('label:')).slice(6)}" in a note to parents — describe what the child can work on instead.`);
  if (problems.includes('link') || problems.includes('phone_number')) throw new NotesError(400, 'Notes cannot contain links or phone numbers.');
  const ok = await claimEditable(user, [id]);
  if (!ok.length) throw new NotesError(404, 'This note is not a draft you can edit.');
  await pool.query('UPDATE parent_progress_notes SET note = $2, edited = TRUE WHERE id = $1', [id, note]);
  await audit({ schoolId: user.school_id, actorType: 'user', actorId: user.teacher_id, action: 'ai.progress_note_edited', entityType: 'parent_progress_note', entityId: id });
  return { id, note };
}

export async function decideNotes(user, ids, approve) {
  const allowed = await claimEditable(user, ids);
  if (!allowed.length) throw new NotesError(409, 'None of these notes are drafts you can decide on.');
  const r = await pool.query(
    `UPDATE parent_progress_notes SET status = $3, approved_by = $4, approved_at = CURRENT_TIMESTAMP
      WHERE school_id = $1 AND id = ANY($2::int[]) AND status = 'draft' RETURNING id`,
    [user.school_id, allowed, approve ? 'approved' : 'rejected', user.teacher_id]
  );
  await audit({ schoolId: user.school_id, actorType: 'user', actorId: user.teacher_id, action: approve ? 'ai.progress_notes_approved' : 'ai.progress_notes_rejected', detail: { count: r.rowCount } });
  if (approve && r.rowCount) {
    const remaining = await pool.query(`SELECT 1 FROM parent_progress_notes WHERE school_id = $1 AND status = 'draft' LIMIT 1`, [user.school_id]);
    if (!remaining.rowCount) {
      await pool.query(
        `UPDATE ops_exceptions SET status = 'resolved', resolved_at = NOW(), resolution_note = 'All parent notes decided'
          WHERE school_id = $1 AND dedupe_key LIKE 'progress_notes:%' AND status IN ('open', 'snoozed')`,
        [user.school_id]
      );
    }
    // Fire and forget: sends now if inside the daytime window, otherwise the
    // scheduled sender picks them up in the morning.
    sendApprovedNotes({ schoolId: user.school_id }).catch((err) => console.error('[progress notes] send after approval failed:', err.message));
  }
  return { updated: r.rowCount, will_send: approve ? (inSendWindow() ? 'now' : 'from 8 AM') : undefined };
}

// ---------- sending ----------

export function inSendWindow(now = new Date()) {
  const h = istHour(now);
  return h >= SEND_WINDOW.from && h < SEND_WINDOW.to;
}

async function templateFor(schoolId) {
  const r = await pool.query(
    `SELECT id, whatsapp_template_name FROM notification_templates WHERE trigger_event = 'parent_progress_note' AND (school_id = $1 OR school_id IS NULL) ORDER BY school_id NULLS LAST LIMIT 1`,
    [schoolId]
  );
  return r.rows[0] || null;
}

export async function sendApprovedNotes({ schoolId = null, now = new Date() } = {}) {
  if (!inSendWindow(now)) return { skipped: 'outside_send_window', sent: 0, failed: 0 };
  // A send interrupted mid-way (process restart) is NOT retried automatically:
  // the WhatsApp message may already have gone, and a parent must never get
  // the same note twice. A person can see it as failed and decide.
  await pool.query(
    `UPDATE parent_progress_notes SET status = 'failed', error = 'Sending was interrupted — check with the parent before sending again'
      WHERE status = 'sending' AND send_started_at < NOW() - INTERVAL '30 minutes' AND ($1::int IS NULL OR school_id = $1)`,
    [schoolId]
  );
  const claimed = await pool.query(
    `UPDATE parent_progress_notes SET status = 'sending', send_started_at = CURRENT_TIMESTAMP
      WHERE id IN (SELECT id FROM parent_progress_notes WHERE status = 'approved' AND ($1::int IS NULL OR school_id = $1)
                   ORDER BY approved_at LIMIT 300 FOR UPDATE SKIP LOCKED)
      RETURNING id, school_id, student_id, parent_id, note`,
    [schoolId]
  );
  let sent = 0;
  let failed = 0;
  const templates = new Map();
  for (const n of claimed.rows) {
    let error = null;
    let messageId = null;
    let tpl = null;
    try {
      const p = await pool.query(
        `SELECT p.phone, p.opt_in_status, p.ai_notes_consent, p.preferred_language, s.name AS student_name, ss.progress_notes_consent_mode AS mode
           FROM parents p JOIN students s ON s.id = $2 LEFT JOIN school_settings ss ON ss.school_id = s.school_id
          WHERE p.id = $1`,
        [n.parent_id, n.student_id]
      );
      const parent = p.rows[0];
      const consentOk = parent && (parent.mode === 'opt_out' ? parent.ai_notes_consent !== 'declined' : parent.ai_notes_consent === 'granted');
      if (!parent || !parent.phone) error = 'No parent phone number';
      else if (parent.opt_in_status !== 'OPTED_IN') error = 'Parent has turned off WhatsApp messages';
      else if (!consentOk) error = 'Parent consent for AI notes was withdrawn';
      else {
        if (!templates.has(n.school_id)) templates.set(n.school_id, await templateFor(n.school_id));
        tpl = templates.get(n.school_id);
        if (!tpl?.whatsapp_template_name) error = 'No WhatsApp template configured for parent_progress_note';
        else {
          const { result } = await sendWithLanguageFallback(
            (lang) => sendTemplateMessage(n.school_id, parent.phone, tpl.whatsapp_template_name, lang, [toTemplateParam(firstName(parent.student_name), 60), toTemplateParam(n.note, 700)]),
            parentTemplateLanguage(parent.preferred_language)
          );
          messageId = result?.messages?.[0]?.id || null;
        }
      }
    } catch (err) {
      error = err.response?.data?.error?.message || err.message;
    }
    await pool.query(
      `UPDATE parent_progress_notes SET status = $2::varchar, sent_at = CASE WHEN $2::varchar = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END, error = $3 WHERE id = $1`,
      [n.id, error ? 'failed' : 'sent', error ? String(error).slice(0, 300) : null]
    );
    if (!error) {
      sent += 1;
      await pool.query(
        `INSERT INTO dashboard_notifications (school_id, template_id, trigger_event, recipient_type, recipient_id, student_id, channel_used, title, body, whatsapp_status, whatsapp_message_id, sent_at)
         VALUES ($1,$2,'parent_progress_note','parent',$3,$4,'whatsapp','Weekly progress note',$5,'sent',$6,CURRENT_TIMESTAMP)`,
        [n.school_id, tpl?.id || null, n.parent_id, n.student_id, n.note, messageId]
      ).catch((err) => console.error('[progress notes] notification log failed:', err.message));
    } else failed += 1;
  }
  return { sent, failed };
}

// ---------- consent ----------

export async function listConsent(user, classId) {
  const scope = await approvalScope(user);
  if (!scope.all && !scope.classIds.includes(Number(classId))) throw new NotesError(403, 'You can only see consent for your own class.');
  const { rows } = await pool.query(
    `SELECT p.id AS parent_id, p.name AS parent_name, p.opt_in_status, p.ai_notes_consent, p.ai_notes_consent_at, p.preferred_language,
            string_agg(s.name, ', ' ORDER BY s.name) AS children
       FROM students s JOIN parents p ON p.id = s.parent_id
      WHERE s.school_id = $1 AND s.class_id = $2 AND COALESCE(s.is_demo, FALSE) = FALSE
      GROUP BY p.id ORDER BY p.name`,
    [user.school_id, classId]
  );
  return rows;
}

export async function setConsent(user, parentIds, consent) {
  if (!['granted', 'declined', 'unknown'].includes(consent)) throw new NotesError(400, 'consent must be granted, declined or unknown');
  const scope = await approvalScope(user);
  const ids = [...new Set((parentIds || []).map(Number).filter(Number.isInteger))].slice(0, 1000);
  if (!ids.length) throw new NotesError(400, 'Pick at least one parent.');
  const r = await pool.query(
    `UPDATE parents p SET ai_notes_consent = $3, ai_notes_consent_at = CURRENT_TIMESTAMP, ai_notes_consent_by = $4
      WHERE p.school_id = $1 AND p.id = ANY($2::int[])
        AND ($5::boolean OR EXISTS (SELECT 1 FROM students s WHERE s.parent_id = p.id AND s.class_id = ANY($6::int[])))
      RETURNING p.id`,
    [user.school_id, ids, consent, user.teacher_id, scope.all, scope.classIds || []]
  );
  // A declined parent's pending drafts are withdrawn at once.
  if (consent === 'declined') {
    await pool.query(`UPDATE parent_progress_notes SET status = 'rejected', error = 'Parent declined AI notes' WHERE school_id = $1 AND parent_id = ANY($2::int[]) AND status IN ('draft','approved')`, [user.school_id, r.rows.map((x) => x.id)]);
  }
  await audit({ schoolId: user.school_id, actorType: 'user', actorId: user.teacher_id, action: 'ai.progress_notes_consent', detail: { consent, parents: r.rowCount } });
  return { updated: r.rowCount };
}
