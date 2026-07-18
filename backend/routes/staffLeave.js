import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

const LEAVE_TYPES = ['casual', 'sick', 'earned'];

function countDays(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const diff = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
  return diff > 0 ? diff : 0;
}

// GET /api/staff-leave/balances — current teacher's balances for this year
// (principal can pass ?teacher_id= to view someone else's)
router.get('/balances', requireAuth, async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const teacherId = req.user.role === 'principal' && req.query.teacher_id ? req.query.teacher_id : req.user.teacher_id;

  try {
    const { rows } = await pool.query(
      `SELECT leave_type, total_days, used_days FROM staff_leave_balances
       WHERE school_id = $1 AND teacher_id = $2 AND year = $3`,
      [req.user.school_id, teacherId, year]
    );

    // Fill in defaults for any leave type that has no row yet, so the
    // frontend always sees all three types (0/0 rather than missing).
    const byType = Object.fromEntries(rows.map((r) => [r.leave_type, r]));
    const result = LEAVE_TYPES.map((t) => byType[t] || { leave_type: t, total_days: 0, used_days: 0 });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/staff-leave/balances — principal sets a teacher's yearly allotment
router.put('/balances', requireAuth, requirePrincipal, async (req, res) => {
  const { teacher_id, year, leave_type, total_days } = req.body;
  if (!teacher_id || !year || !LEAVE_TYPES.includes(leave_type) || total_days == null) {
    return res.status(400).json({ error: 'teacher_id, year, leave_type (casual|sick|earned) and total_days are required' });
  }

  try {
    // teacher_id was never checked against the caller's own school. Since
    // the conflict target is (teacher_id, year, leave_type) with no
    // school_id in it, an unscoped call could overwrite a DIFFERENT
    // school's teacher's leave balance outright.
    const teacherCheck = await pool.query('SELECT id FROM teachers WHERE id = $1 AND school_id = $2', [teacher_id, req.user.school_id]);
    if (teacherCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Teacher not found for this school' });
    }

    const { rows } = await pool.query(
      `INSERT INTO staff_leave_balances (school_id, teacher_id, year, leave_type, total_days)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (teacher_id, year, leave_type)
       DO UPDATE SET total_days = EXCLUDED.total_days
       RETURNING *`,
      [req.user.school_id, teacher_id, year, leave_type, total_days]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/staff-leave/requests — a teacher applies for leave
router.post('/requests', requireAuth, async (req, res) => {
  const { leave_type, start_date, end_date, reason } = req.body;
  if (!LEAVE_TYPES.includes(leave_type) || !start_date || !end_date) {
    return res.status(400).json({ error: 'leave_type (casual|sick|earned), start_date and end_date are required' });
  }
  if (new Date(end_date) < new Date(start_date)) {
    return res.status(400).json({ error: 'end_date cannot be before start_date' });
  }

  const days = countDays(start_date, end_date);
  try {
    const { rows } = await pool.query(
      `INSERT INTO staff_leave_requests (school_id, teacher_id, leave_type, start_date, end_date, days_count, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.school_id, req.user.teacher_id, leave_type, start_date, end_date, days, reason || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/staff-leave/requests — principal sees all staff requests (optional ?status=),
// a teacher sees only their own
router.get('/requests', requireAuth, async (req, res) => {
  const { status } = req.query;
  const params = [req.user.school_id];
  let where = 'sl.school_id = $1';

  if (req.user.role !== 'principal') {
    params.push(req.user.teacher_id);
    where += ` AND sl.teacher_id = $${params.length}`;
  }
  if (status) {
    params.push(status.toUpperCase());
    where += ` AND sl.status = $${params.length}`;
  }

  try {
    const { rows } = await pool.query(
      `SELECT sl.*, t.name AS teacher_name, t.role AS teacher_role
       FROM staff_leave_requests sl JOIN teachers t ON t.id = sl.teacher_id
       WHERE ${where} ORDER BY sl.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/staff-leave/requests/:id — principal approves/rejects; on approval,
// the used_days balance is incremented (creating the balance row if missing).
router.put('/requests/:id', requireAuth, requirePrincipal, async (req, res) => {
  const { id } = req.params;
  const { status, review_note } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'status must be APPROVED or REJECTED' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: reqRows } = await client.query(
      `SELECT * FROM staff_leave_requests WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [id, req.user.school_id]
    );
    if (reqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Leave request not found' });
    }
    const leaveReq = reqRows[0];
    if (leaveReq.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Request already ${leaveReq.status.toLowerCase()}` });
    }

    const { rows: updated } = await client.query(
      `UPDATE staff_leave_requests
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3
       WHERE id = $4 RETURNING *`,
      [status, req.user.teacher_id, review_note || null, id]
    );

    if (status === 'APPROVED') {
      const year = new Date(leaveReq.start_date).getFullYear();
      await client.query(
        `INSERT INTO staff_leave_balances (school_id, teacher_id, year, leave_type, total_days, used_days)
         VALUES ($1, $2, $3, $4, 0, $5)
         ON CONFLICT (teacher_id, year, leave_type)
         DO UPDATE SET used_days = staff_leave_balances.used_days + EXCLUDED.used_days`,
        [req.user.school_id, leaveReq.teacher_id, year, leaveReq.leave_type, leaveReq.days_count]
      );
    }

    await client.query('COMMIT');
    res.json(updated[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
