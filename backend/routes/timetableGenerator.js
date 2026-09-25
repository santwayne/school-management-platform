import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireOperator } from '../middleware/auth.js';
import { audit } from '../services/opsService.js';
import { solveTimetable, hardViolations } from '../services/timetableSolver.js';
import { planSubstitutions } from '../services/substitutionService.js';

const router = express.Router();
router.use(requireAuth, requireOperator);
const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

async function config(schoolId) {
  const r = await pool.query(
    `SELECT COALESCE(periods_per_day, 8) AS periods_per_day, COALESCE(working_days, '1,2,3,4,5,6') AS working_days, period_times FROM school_settings WHERE school_id = $1`,
    [schoolId]
  );
  const c = r.rows[0] || { periods_per_day: 8, working_days: '1,2,3,4,5,6', period_times: null };
  return { ...c, days: c.working_days.split(',').map(Number).filter((d) => d >= 1 && d <= 7) };
}

router.get('/config', async (req, res) => res.json(await config(req.user.school_id)));
router.put('/config', async (req, res) => {
  const { periods_per_day, working_days, period_times } = req.body || {};
  if (periods_per_day && !(periods_per_day >= 1 && periods_per_day <= 12)) return res.status(400).json({ error: 'periods_per_day must be 1–12' });
  if (working_days && !/^[1-7](,[1-7]){0,6}$/.test(working_days)) return res.status(400).json({ error: 'working_days like 1,2,3,4,5,6 (1 = Monday)' });
  if (period_times && (!Array.isArray(period_times) || !period_times.every((p) => /^\d{2}:\d{2}$/.test(p.start) && /^\d{2}:\d{2}$/.test(p.end)))) {
    return res.status(400).json({ error: 'period_times must be [{start:"HH:MM", end:"HH:MM"}, ...]' });
  }
  await pool.query(
    `INSERT INTO school_settings (school_id, periods_per_day, working_days, period_times) VALUES ($1, COALESCE($2, 8), COALESCE($3, '1,2,3,4,5,6'), $4)
     ON CONFLICT (school_id) DO UPDATE SET periods_per_day = COALESCE($2, school_settings.periods_per_day),
       working_days = COALESCE($3, school_settings.working_days), period_times = COALESCE($4, school_settings.period_times), updated_at = NOW()`,
    [req.user.school_id, periods_per_day || null, working_days || null, period_times ? JSON.stringify(period_times) : null]
  );
  res.json(await config(req.user.school_id));
});

router.get('/requirements', async (req, res) => {
  const r = await pool.query(
    `SELECT r.*, c.name || COALESCE(' ' || c.section, '') AS class_label, s.name AS subject_name, t.name AS teacher_name
     FROM timetable_requirements r JOIN classes c ON c.id = r.class_id JOIN subjects s ON s.id = r.subject_id LEFT JOIN teachers t ON t.id = r.teacher_id
     WHERE r.school_id = $1 ORDER BY class_label, s.name`,
    [req.user.school_id]
  );
  res.json(r.rows);
});

// Replace all requirements for the classes in the payload.
router.put('/requirements', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ error: 'items array required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const classIds = [...new Set(items.map((i) => Number(i.class_id)))];
    const own = await client.query(`SELECT id FROM classes WHERE school_id = $1 AND id = ANY($2::int[])`, [req.user.school_id, classIds]);
    if (own.rowCount !== classIds.length) throw Object.assign(new Error('Unknown class in items'), { status: 400 });
    await client.query(`DELETE FROM timetable_requirements WHERE school_id = $1 AND class_id = ANY($2::int[])`, [req.user.school_id, classIds]);
    for (const i of items) {
      await client.query(
        `INSERT INTO timetable_requirements (school_id, class_id, subject_id, teacher_id, periods_per_week, heavy) VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.user.school_id, i.class_id, i.subject_id, i.teacher_id || null, i.periods_per_week, !!i.heavy]
      );
    }
    await client.query('COMMIT');
    res.json({ saved: items.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err.code === '23514' ? Object.assign(new Error('periods_per_week must be 1–20'), { status: 400 }) : err);
  } finally {
    client.release();
  }
});

// Start from what's already in timetable_slots (count periods per class/subject/teacher).
router.post('/requirements/from-current', async (req, res) => {
  const r = await pool.query(
    `INSERT INTO timetable_requirements (school_id, class_id, subject_id, teacher_id, periods_per_week)
     SELECT school_id, class_id, subject_id, MIN(teacher_id), COUNT(*) FROM timetable_slots
     WHERE school_id = $1 AND subject_id IS NOT NULL GROUP BY school_id, class_id, subject_id
     ON CONFLICT (class_id, subject_id) DO NOTHING RETURNING id`,
    [req.user.school_id]
  );
  res.json({ imported: r.rowCount });
});

router.get('/unavailability', async (req, res) => {
  const r = await pool.query(`SELECT u.*, t.name AS teacher_name FROM teacher_unavailability u JOIN teachers t ON t.id = u.teacher_id WHERE u.school_id = $1 ORDER BY t.name, day_of_week, period_number`, [req.user.school_id]);
  res.json(r.rows);
});
router.put('/unavailability', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  await pool.query(`DELETE FROM teacher_unavailability WHERE school_id = $1`, [req.user.school_id]);
  for (const u of items) {
    await pool.query(
      `INSERT INTO teacher_unavailability (school_id, teacher_id, day_of_week, period_number) SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM teachers WHERE id = $2 AND school_id = $1) ON CONFLICT DO NOTHING`,
      [req.user.school_id, u.teacher_id, u.day_of_week, u.period_number]
    );
  }
  res.json({ saved: items.length });
});

router.post('/generate', async (req, res) => {
  const schoolId = req.user.school_id;
  try {
    const cfg = await config(schoolId);
    const reqs = await pool.query(`SELECT class_id, subject_id, teacher_id, periods_per_week, heavy FROM timetable_requirements WHERE school_id = $1`, [schoolId]);
    if (!reqs.rowCount) return res.status(400).json({ error: 'Add what each class needs first (subjects, teachers, periods per week).' });
    // Capacity check up front: clearer than a pile of unplaced lessons.
    const perClass = new Map();
    for (const r of reqs.rows) perClass.set(r.class_id, (perClass.get(r.class_id) || 0) + r.periods_per_week);
    const capacity = cfg.days.length * cfg.periods_per_day;
    const over = [...perClass].filter(([, n]) => n > capacity);
    if (over.length) {
      const names = await pool.query(`SELECT id, name || COALESCE(' ' || section, '') AS label FROM classes WHERE id = ANY($1::int[])`, [over.map(([id]) => id)]);
      return res.status(400).json({ error: `These classes need more periods than the week has (${capacity}): ${names.rows.map((n) => `${n.label} (${perClass.get(n.id)})`).join(', ')}` });
    }
    const unav = await pool.query(`SELECT teacher_id, day_of_week AS day, period_number AS period FROM teacher_unavailability WHERE school_id = $1`, [schoolId]);
    const result = solveTimetable({
      days: cfg.days,
      periodsPerDay: cfg.periods_per_day,
      requirements: reqs.rows,
      unavailable: unav.rows,
      seed: Number(req.body?.seed) || 1,
      timeLimitMs: Number(process.env.TIMETABLE_SOLVER_SECONDS || 20) * 1000,
    });
    const d = await pool.query(
      `INSERT INTO timetable_drafts (school_id, slots, unplaced, penalty, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [schoolId, JSON.stringify(result.slots), JSON.stringify(result.unplaced), result.penalty, req.user.teacher_id]
    );
    await audit({ schoolId, actorType: 'user', actorId: req.user.teacher_id, action: 'timetable.generated', entityType: 'timetable_draft', entityId: d.rows[0].id, detail: { lessons: result.stats.lessons, unplaced: result.unplaced.length, penalty: result.penalty } });
    res.status(201).json({ draft_id: d.rows[0].id, placed: result.slots.length, unplaced: result.unplaced.length, penalty: result.penalty });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/drafts', async (req, res) => {
  const r = await pool.query(
    `SELECT id, status, penalty, jsonb_array_length(slots) AS lessons, jsonb_array_length(unplaced) AS unplaced, created_at, published_at FROM timetable_drafts WHERE school_id = $1 ORDER BY id DESC LIMIT 30`,
    [req.user.school_id]
  );
  res.json(r.rows);
});

router.get('/drafts/:id', async (req, res) => {
  const d = await pool.query(`SELECT * FROM timetable_drafts WHERE id = $1 AND school_id = $2`, [req.params.id, req.user.school_id]);
  if (!d.rowCount) return res.status(404).json({ error: 'Not found' });
  const names = await pool.query(
    `SELECT 'c' || id AS k, name || COALESCE(' ' || section, '') AS v FROM classes WHERE school_id = $1
     UNION ALL SELECT 's' || id, name FROM subjects WHERE school_id = $1
     UNION ALL SELECT 't' || id, name FROM teachers WHERE school_id = $1`,
    [req.user.school_id]
  );
  res.json({ ...d.rows[0], names: Object.fromEntries(names.rows.map((n) => [n.k, n.v])) });
});

// Publish: principal only. Updates slots in place so ids (and the lesson
// plans / substitution history pointing at them) survive.
router.post('/drafts/:id/publish', async (req, res) => {
  if (req.user.role !== 'principal') return res.status(403).json({ error: 'Only the principal can publish a timetable' });
  const schoolId = req.user.school_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const d = await client.query(`SELECT * FROM timetable_drafts WHERE id = $1 AND school_id = $2 AND status IN ('draft', 'backup') FOR UPDATE`, [req.params.id, schoolId]);
    if (!d.rowCount) throw Object.assign(new Error('Draft not found or already published'), { status: 404 });
    const draft = d.rows[0];
    const unav = await client.query(`SELECT teacher_id, day_of_week AS day, period_number AS period FROM teacher_unavailability WHERE school_id = $1`, [schoolId]);
    const v = hardViolations(draft.slots, unav.rows, 20);
    if (v.length) throw Object.assign(new Error(`Draft has clashes: ${v.slice(0, 3).join('; ')}`), { status: 409 });
    const cfg = await config(schoolId);
    const times = Array.isArray(cfg.period_times) ? cfg.period_times : [];

    // Backup of the current timetable for rollback.
    const current = await client.query(`SELECT class_id, day_of_week AS day, period_number AS period, subject_id, teacher_id FROM timetable_slots WHERE school_id = $1`, [schoolId]);
    await client.query(`INSERT INTO timetable_drafts (school_id, slots, status, created_by) VALUES ($1, $2, 'backup', $3)`, [schoolId, JSON.stringify(current.rows), req.user.teacher_id]);

    const before = new Map(current.rows.map((s) => [`${s.class_id}:${s.day}:${s.period}`, s.teacher_id]));
    const changedTeacherKeys = [];
    for (const s of draft.slots) {
      const t = times[s.period - 1] || {};
      await client.query(
        `INSERT INTO timetable_slots (school_id, class_id, day_of_week, period_number, start_time, end_time, subject_id, teacher_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (class_id, day_of_week, period_number) DO UPDATE SET subject_id = EXCLUDED.subject_id, teacher_id = EXCLUDED.teacher_id,
           start_time = COALESCE(EXCLUDED.start_time, timetable_slots.start_time), end_time = COALESCE(EXCLUDED.end_time, timetable_slots.end_time)`,
        [schoolId, s.class_id, s.day, s.period, t.start || null, t.end || null, s.subject_id, s.teacher_id]
      );
      const key = `${s.class_id}:${s.day}:${s.period}`;
      if (before.has(key) && before.get(key) !== s.teacher_id) changedTeacherKeys.push(key);
    }
    // Remove slots (of the draft's classes) that the new timetable doesn't have.
    const classIds = [...new Set(draft.slots.map((s) => s.class_id))];
    const keep = draft.slots.map((s) => `${s.class_id}:${s.day}:${s.period}`);
    const removed = await client.query(
      `DELETE FROM timetable_slots WHERE school_id = $1 AND class_id = ANY($2::int[]) AND NOT ((class_id || ':' || day_of_week || ':' || period_number) = ANY($3::text[])) RETURNING id`,
      [schoolId, classIds, keep]
    );
    // Upcoming substitutions on periods whose teacher changed are no longer right.
    await client.query(
      `UPDATE substitutions x SET status = 'cancelled', updated_at = NOW() FROM timetable_slots ts
       WHERE x.timetable_slot_id = ts.id AND x.school_id = $1 AND x.date >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date AND x.status <> 'cancelled'
         AND (ts.class_id || ':' || ts.day_of_week || ':' || ts.period_number) = ANY($2::text[])`,
      [schoolId, changedTeacherKeys]
    );
    await client.query(`UPDATE timetable_drafts SET status = 'published', published_at = NOW() WHERE id = $1`, [draft.id]);
    await client.query(`UPDATE timetable_drafts SET status = 'discarded' WHERE school_id = $1 AND status = 'published' AND id <> $2`, [schoolId, draft.id]);
    await client.query('COMMIT');
    const today = (await pool.query(`SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)).rows[0].d;
    await planSubstitutions(schoolId, today).catch(() => {});
    await audit({ schoolId, actorType: 'user', actorId: req.user.teacher_id, action: 'timetable.published', entityType: 'timetable_draft', entityId: draft.id, detail: { lessons: draft.slots.length, removed: removed.rowCount, teacher_changes: changedTeacherKeys.length } });
    res.json({ published: true, lessons: draft.slots.length, removed_slots: removed.rowCount, teacher_changes: changedTeacherKeys.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally {
    client.release();
  }
});

export default router;
