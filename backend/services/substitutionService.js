import pool from '../config/db.js';
import { sendTemplateMessage } from './whatsappService.js';
import { raiseException, audit } from './opsService.js';

// ------------------------------------------------------------------
// Teacher substitution planner.
//
// Deterministic by design (no AI): the operator must be able to predict
// and explain every assignment. rankCandidates() is pure and unit-tested;
// planSubstitutions() gathers facts from SQL and writes the result.
//
// Idempotent: runs every 15 min; the partial unique index on
// (timetable_slot_id, date) means a period is never assigned twice, and
// already-assigned periods are skipped.
// ------------------------------------------------------------------

// candidates: [{ id, name, subjectIds:Set, classIds:Set, subsThisWeek, periodsToday, subsToday }]
// slot: { subject_id, class_id }
export function rankCandidates(slot, candidates, { maxPerDay = 2 } = {}) {
  return candidates
    .filter((c) => c.subsToday < maxPerDay)
    .map((c) => {
      const sameSubject = slot.subject_id != null && c.subjectIds.has(slot.subject_id);
      const knowsClass = c.classIds.has(slot.class_id);
      const score = (sameSubject ? 100 : 0) + (knowsClass ? 50 : 0) - c.subsThisWeek * 10 - c.periodsToday * 3 - c.subsToday * 20;
      return { ...c, score, sameSubject, knowsClass };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

export function explain(c) {
  const bits = [];
  if (c.sameSubject) bits.push('teaches this subject');
  if (c.knowsClass) bits.push('already teaches this class');
  bits.push(`${c.subsThisWeek} substitution(s) this week`);
  return bits.join(', ');
}

async function istNow() {
  const r = await pool.query(
    `SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS today,
            (NOW() AT TIME ZONE 'Asia/Kolkata')::time AS now_time,
            EXTRACT(ISODOW FROM (NOW() AT TIME ZONE 'Asia/Kolkata'))::int AS dow`
  );
  return r.rows[0];
}

// Who is absent on `date`, and why.
async function absentTeachers(schoolId, date, { checkPunches }) {
  const absent = new Map(); // teacher_id -> reason
  const leave = await pool.query(
    `SELECT teacher_id FROM staff_leave_requests WHERE school_id = $1 AND status = 'APPROVED' AND $2::date BETWEEN start_date AND end_date`,
    [schoolId, date]
  );
  for (const r of leave.rows) absent.set(r.teacher_id, 'leave');
  const marked = await pool.query(`SELECT teacher_id FROM teacher_absence_marks WHERE school_id = $1 AND date = $2`, [schoolId, date]);
  for (const r of marked.rows) if (!absent.has(r.teacher_id)) absent.set(r.teacher_id, 'manual');

  if (checkPunches) {
    // Teachers who have classes today but haven't punched in.
    const noPunch = await pool.query(
      `SELECT DISTINCT ts.teacher_id FROM timetable_slots ts
       WHERE ts.school_id = $1 AND ts.day_of_week = EXTRACT(ISODOW FROM $2::date) AND ts.teacher_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM teacher_punch_events p WHERE p.teacher_id = ts.teacher_id
             AND (p.punch_time AT TIME ZONE 'Asia/Kolkata')::date = $2::date
         )`,
      [schoolId, date]
    );
    for (const r of noPunch.rows) if (!absent.has(r.teacher_id)) absent.set(r.teacher_id, 'no_punch');
  }
  return absent;
}

async function notifySubstitute({ schoolId, sub, slot, absentName, date }) {
  const t = await pool.query(`SELECT id, name, whatsapp_number, whatsapp_opt_in_status FROM teachers WHERE id = $1`, [sub.id]);
  const teacher = t.rows[0];
  const plan = await pool.query(
    `SELECT title FROM lesson_plans WHERE (timetable_slot_id = $1 AND plan_date = $2) OR (class_id = $3 AND subject_id = $4 AND plan_date = $2) ORDER BY id DESC LIMIT 1`,
    [slot.id, date, slot.class_id, slot.subject_id]
  );
  const what = `Period ${slot.period_number}${slot.start_time ? ` (${String(slot.start_time).slice(0, 5)})` : ''}, ${slot.class_label}, ${slot.subject_name || 'class'}`;
  const body = `${what} for ${absentName}.${plan.rows[0] ? ` Lesson plan: ${plan.rows[0].title}.` : ''}`;
  await pool.query(
    `INSERT INTO dashboard_notifications (school_id, trigger_event, recipient_type, recipient_id, channel_used, title, body)
     VALUES ($1, 'substitution_assigned', 'staff', $2, 'dashboard', 'Substitution today', $3)`,
    [schoolId, sub.id, body]
  );
  // Template (Utility, en): substitution_assigned {{1}} teacher name, {{2}} what
  // "Hi {{1}}, you have a substitution today: {{2}}. Please check the Waynur app for details."
  if (teacher?.whatsapp_opt_in_status === 'OPTED_IN' && teacher.whatsapp_number) {
    try {
      await sendTemplateMessage(String(teacher.whatsapp_number).replace(/^\+/, ''), process.env.WHATSAPP_SUBSTITUTION_TEMPLATE || 'substitution_assigned', 'en', [teacher.name, body.slice(0, 500)]);
    } catch (err) {
      console.error(`[substitution] WhatsApp to teacher ${sub.id} failed:`, err.response?.data?.error?.message || err.message);
    }
  }
}

// Plan (or top up) substitutions for one school and date.
export async function planSubstitutions(schoolId, date, { checkPunches = false } = {}) {
  const settings = await pool.query(
    `SELECT COALESCE(max_substitutions_per_day, 2) AS max_per_day FROM school_settings WHERE school_id = $1`,
    [schoolId]
  );
  const maxPerDay = settings.rows[0]?.max_per_day ?? 2;
  const absent = await absentTeachers(schoolId, date, { checkPunches });
  if (absent.size === 0) return { assigned: 0, unfilled: 0 };

  const dowRes = await pool.query(`SELECT EXTRACT(ISODOW FROM $1::date)::int AS dow`, [date]);
  const dow = dowRes.rows[0].dow;
  const absentIds = [...absent.keys()];

  const slots = await pool.query(
    `SELECT ts.id, ts.class_id, ts.subject_id, ts.period_number, ts.start_time, ts.teacher_id,
            c.name || COALESCE(' ' || c.section, '') AS class_label, s.name AS subject_name, t.name AS absent_name
     FROM timetable_slots ts
     JOIN classes c ON c.id = ts.class_id
     LEFT JOIN subjects s ON s.id = ts.subject_id
     JOIN teachers t ON t.id = ts.teacher_id
     WHERE ts.school_id = $1 AND ts.day_of_week = $2 AND ts.teacher_id = ANY($3::int[])
       AND NOT EXISTS (SELECT 1 FROM substitutions x WHERE x.timetable_slot_id = ts.id AND x.date = $4 AND x.status <> 'cancelled')
     ORDER BY ts.period_number`,
    [schoolId, dow, absentIds, date]
  );
  if (!slots.rowCount) return { assigned: 0, unfilled: 0 };

  // Everyone else who teaches, with their load.
  const staff = await pool.query(
    `SELECT t.id, t.name,
            COALESCE(array_agg(DISTINCT ts.subject_id) FILTER (WHERE ts.subject_id IS NOT NULL), '{}') AS subject_ids,
            COALESCE(array_agg(DISTINCT ts.class_id) FILTER (WHERE ts.class_id IS NOT NULL), '{}') AS class_ids
     FROM teachers t LEFT JOIN timetable_slots ts ON ts.teacher_id = t.id
     WHERE t.school_id = $1 AND t.role = 'teacher' AND NOT (t.id = ANY($2::int[]))
     GROUP BY t.id, t.name`,
    [schoolId, absentIds]
  );
  const busy = await pool.query(
    `SELECT teacher_id, period_number FROM timetable_slots WHERE school_id = $1 AND day_of_week = $2 AND teacher_id IS NOT NULL
     UNION
     SELECT x.substitute_teacher_id, ts.period_number FROM substitutions x JOIN timetable_slots ts ON ts.id = x.timetable_slot_id
     WHERE x.school_id = $1 AND x.date = $3 AND x.status = 'assigned'`,
    [schoolId, dow, date]
  );
  const load = await pool.query(
    `SELECT substitute_teacher_id AS id,
            COUNT(*) FILTER (WHERE date = $2)::int AS today,
            COUNT(*)::int AS week
     FROM substitutions WHERE school_id = $1 AND status = 'assigned'
       AND date BETWEEN $2::date - (EXTRACT(ISODOW FROM $2::date)::int - 1) AND $2::date
     GROUP BY substitute_teacher_id`,
    [schoolId, date]
  );
  const periodsToday = await pool.query(
    `SELECT teacher_id AS id, COUNT(*)::int AS n FROM timetable_slots WHERE school_id = $1 AND day_of_week = $2 GROUP BY teacher_id`,
    [schoolId, dow]
  );

  const busySet = new Set(busy.rows.map((b) => `${b.teacher_id}:${b.period_number}`));
  const loadMap = new Map(load.rows.map((l) => [l.id, l]));
  const periodMap = new Map(periodsToday.rows.map((p) => [p.id, p.n]));
  const pool_ = staff.rows.map((s) => ({
    id: s.id,
    name: s.name,
    subjectIds: new Set(s.subject_ids),
    classIds: new Set(s.class_ids),
    subsThisWeek: loadMap.get(s.id)?.week || 0,
    subsToday: loadMap.get(s.id)?.today || 0,
    periodsToday: periodMap.get(s.id) || 0,
  }));

  // Only teachers who are actually in school can cover (when punches are checked).
  let present = null;
  if (checkPunches) {
    const p = await pool.query(
      `SELECT DISTINCT teacher_id FROM teacher_punch_events WHERE school_id = $1 AND (punch_time AT TIME ZONE 'Asia/Kolkata')::date = $2::date`,
      [schoolId, date]
    );
    present = new Set(p.rows.map((r) => r.teacher_id));
  }

  let assigned = 0;
  let unfilled = 0;
  for (const slot of slots.rows) {
    const free = pool_.filter((c) => !busySet.has(`${c.id}:${slot.period_number}`) && (!present || present.has(c.id)));
    const ranked = rankCandidates(slot, free, { maxPerDay });
    const best = ranked[0];
    const reason = absent.get(slot.teacher_id);
    const ins = await pool.query(
      `INSERT INTO substitutions (school_id, date, timetable_slot_id, absent_teacher_id, substitute_teacher_id, status, reason, score_detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (timetable_slot_id, date) WHERE status <> 'cancelled' DO NOTHING RETURNING id`,
      [schoolId, date, slot.id, slot.teacher_id, best?.id || null, best ? 'assigned' : 'unfilled', reason, JSON.stringify(best ? { score: best.score, why: explain(best) } : { candidates: free.length })]
    );
    if (!ins.rowCount) continue; // another run got there first
    const subId = ins.rows[0].id;
    if (best) {
      assigned += 1;
      busySet.add(`${best.id}:${slot.period_number}`);
      // rankCandidates returns copies: update the shared record, otherwise
      // the daily cap never takes effect within a single run.
      const original = pool_.find((c) => c.id === best.id);
      original.subsToday += 1;
      original.subsThisWeek += 1;
      await notifySubstitute({ schoolId, sub: best, slot, absentName: slot.absent_name, date });
      await audit({ schoolId, actorType: 'system', action: 'substitution.assigned', entityType: 'substitution', entityId: subId, detail: { period: slot.period_number, class: slot.class_label, to: best.name, why: explain(best) } });
    } else {
      unfilled += 1;
      await raiseException({
        schoolId,
        source: 'substitution',
        severity: 'high',
        title: `No teacher free for ${slot.class_label}, period ${slot.period_number} (${slot.absent_name} absent)`,
        body: `Every teacher is either busy that period, absent, or has already taken ${maxPerDay} substitutions today. Assign someone from the Substitutions screen, combine the class with another section, or send it to the library.`,
        entityType: 'substitution',
        entityId: subId,
        dedupeKey: `sub_unfilled:${subId}`,
      });
    }
  }
  return { assigned, unfilled };
}

// A teacher flagged for "no punch" who then punches in: cancel their
// remaining substitutions for periods that haven't started.
export async function releaseLateArrivals(schoolId, date, nowTime) {
  const r = await pool.query(
    `UPDATE substitutions x SET status = 'cancelled', updated_at = NOW()
     FROM timetable_slots ts
     WHERE x.timetable_slot_id = ts.id AND x.school_id = $1 AND x.date = $2 AND x.reason = 'no_punch' AND x.status IN ('assigned', 'unfilled')
       AND (ts.start_time IS NULL OR ts.start_time > $3::time)
       AND EXISTS (SELECT 1 FROM teacher_punch_events p WHERE p.teacher_id = x.absent_teacher_id AND (p.punch_time AT TIME ZONE 'Asia/Kolkata')::date = $2::date)
     RETURNING x.id, x.substitute_teacher_id`,
    [schoolId, date, nowTime]
  );
  for (const row of r.rows) {
    if (row.substitute_teacher_id) {
      await pool.query(
        `INSERT INTO dashboard_notifications (school_id, trigger_event, recipient_type, recipient_id, channel_used, title, body)
         VALUES ($1, 'substitution_cancelled', 'staff', $2, 'dashboard', 'Substitution cancelled', 'The teacher has arrived, so your substitution is no longer needed.')`,
        [schoolId, row.substitute_teacher_id]
      );
    }
    await pool.query(`UPDATE ops_exceptions SET status = 'resolved', resolved_at = NOW(), resolution_note = 'Teacher arrived' WHERE dedupe_key = $1 AND status IN ('open', 'snoozed')`, [`sub_unfilled:${row.id}`]);
  }
  return r.rowCount;
}

// Worker entry point: every school, today.
export async function runSubstitutionCycle() {
  const { today, now_time: nowTime, dow } = await istNow();
  if (dow === 7) return { skipped: 'sunday' };
  const schools = await pool.query(
    `SELECT s.id, COALESCE(ss.substitution_cutoff_time, '08:15') AS cutoff, COALESCE(ss.attendance_method, 'biometric') AS method,
            COALESCE(ss.auto_substitution, TRUE) AS enabled,
            EXISTS (SELECT 1 FROM biometric_devices d WHERE d.school_id = s.id) AS has_devices
     FROM schools s LEFT JOIN school_settings ss ON ss.school_id = s.id WHERE s.status = 'active'`
  );
  let assigned = 0;
  let unfilled = 0;
  for (const s of schools.rows) {
    if (!s.enabled) continue;
    const checkPunches = s.method === 'biometric' && s.has_devices && String(nowTime) >= String(s.cutoff);
    await releaseLateArrivals(s.id, today, nowTime);
    const r = await planSubstitutions(s.id, today, { checkPunches });
    assigned += r.assigned;
    unfilled += r.unfilled;
  }
  // Unfilled periods are already inbox items; they are not a failure of
  // the automation itself, so they don't count as failed runs.
  return { processed: assigned, unfilled };
}
