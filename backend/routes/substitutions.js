import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireOperator } from '../middleware/auth.js';
import { audit } from '../services/opsService.js';
import { planSubstitutions } from '../services/substitutionService.js';

const router = express.Router();
router.use(requireAuth, requireOperator);
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

async function today() {
  const r = await pool.query(`SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`);
  return r.rows[0].d;
}

// Day board: every substitution with class, period, who's absent, who covers.
router.get('/', async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : await today();
  try {
    const r = await pool.query(
      `SELECT x.id, x.date, x.status, x.reason, x.score_detail, ts.period_number, ts.start_time, ts.end_time,
              c.name || COALESCE(' ' || c.section, '') AS class_label, s.name AS subject_name,
              a.id AS absent_teacher_id, a.name AS absent_teacher, st.id AS substitute_teacher_id, st.name AS substitute_teacher
       FROM substitutions x JOIN timetable_slots ts ON ts.id = x.timetable_slot_id JOIN classes c ON c.id = ts.class_id
       LEFT JOIN subjects s ON s.id = ts.subject_id JOIN teachers a ON a.id = x.absent_teacher_id LEFT JOIN teachers st ON st.id = x.substitute_teacher_id
       WHERE x.school_id = $1 AND x.date = $2 AND x.status <> 'cancelled'
       ORDER BY ts.period_number, class_label`,
      [req.user.school_id, date]
    );
    res.json({ date, items: r.rows, unfilled: r.rows.filter((i) => i.status === 'unfilled').length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Free teachers for one substitution's period (for manual reassignment).
router.get('/:id/candidates', async (req, res) => {
  try {
    const x = await pool.query(
      `SELECT x.date, ts.period_number, ts.day_of_week FROM substitutions x JOIN timetable_slots ts ON ts.id = x.timetable_slot_id WHERE x.id = $1 AND x.school_id = $2`,
      [req.params.id, req.user.school_id]
    );
    if (!x.rowCount) return res.status(404).json({ error: 'Not found' });
    const { date, period_number: p, day_of_week: dow } = x.rows[0];
    const r = await pool.query(
      `SELECT t.id, t.name FROM teachers t
       WHERE t.school_id = $1 AND t.role = 'teacher'
         AND NOT EXISTS (SELECT 1 FROM timetable_slots ts WHERE ts.teacher_id = t.id AND ts.day_of_week = $2 AND ts.period_number = $3)
         AND NOT EXISTS (SELECT 1 FROM substitutions y JOIN timetable_slots ts2 ON ts2.id = y.timetable_slot_id
                         WHERE y.substitute_teacher_id = t.id AND y.date = $4 AND ts2.period_number = $3 AND y.status = 'assigned')
         AND NOT EXISTS (SELECT 1 FROM staff_leave_requests l WHERE l.teacher_id = t.id AND l.status = 'APPROVED' AND $4::date BETWEEN l.start_date AND l.end_date)
         AND NOT EXISTS (SELECT 1 FROM teacher_absence_marks m WHERE m.teacher_id = t.id AND m.date = $4)
       ORDER BY t.name`,
      [req.user.school_id, dow, p, date]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual reassignment (or filling an unfilled period).
router.patch('/:id', async (req, res) => {
  const teacherId = Number(req.body?.substitute_teacher_id);
  if (!teacherId) return res.status(400).json({ error: 'substitute_teacher_id is required' });
  try {
    const t = await pool.query(`SELECT id, name FROM teachers WHERE id = $1 AND school_id = $2`, [teacherId, req.user.school_id]);
    if (!t.rowCount) return res.status(400).json({ error: 'Teacher not found' });
    const r = await pool.query(
      `UPDATE substitutions SET substitute_teacher_id = $3, status = 'assigned', assigned_by = $4, updated_at = NOW()
       WHERE id = $1 AND school_id = $2 AND status <> 'cancelled' RETURNING *`,
      [req.params.id, req.user.school_id, teacherId, req.user.teacher_id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
    await pool.query(
      `INSERT INTO dashboard_notifications (school_id, trigger_event, recipient_type, recipient_id, channel_used, title, body)
       VALUES ($1, 'substitution_assigned', 'staff', $2, 'dashboard', 'Substitution assigned', 'You have been assigned a substitution. Check Substitutions for details.')`,
      [req.user.school_id, teacherId]
    );
    await pool.query(`UPDATE ops_exceptions SET status = 'resolved', resolved_at = NOW(), resolved_by = $2, resolution_note = $3 WHERE dedupe_key = $1 AND status IN ('open', 'snoozed')`, [`sub_unfilled:${req.params.id}`, req.user.teacher_id, `Assigned to ${t.rows[0].name}`]);
    await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'substitution.reassigned', entityType: 'substitution', entityId: Number(req.params.id), detail: { to: t.rows[0].name } });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark a teacher absent today (no leave request) and plan cover right away.
router.post('/mark-absent', async (req, res) => {
  const teacherId = Number(req.body?.teacher_id);
  const date = isDate(req.body?.date) ? req.body.date : await today();
  try {
    const t = await pool.query(`SELECT id, name FROM teachers WHERE id = $1 AND school_id = $2`, [teacherId, req.user.school_id]);
    if (!t.rowCount) return res.status(400).json({ error: 'Teacher not found' });
    await pool.query(
      `INSERT INTO teacher_absence_marks (school_id, teacher_id, date, marked_by) VALUES ($1, $2, $3, $4) ON CONFLICT (teacher_id, date) DO NOTHING`,
      [req.user.school_id, teacherId, date, req.user.teacher_id]
    );
    await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'substitution.teacher_marked_absent', entityType: 'teacher', entityId: teacherId, detail: { date } });
    res.json(await planSubstitutions(req.user.school_id, date));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plan', async (req, res) => {
  const date = isDate(req.body?.date) ? req.body.date : await today();
  try {
    res.json(await planSubstitutions(req.user.school_id, date));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
