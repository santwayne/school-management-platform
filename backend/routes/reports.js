import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireFinance } from '../middleware/auth.js';

const router = express.Router();

// Attendance report — per-student attendance % over a date range.
// Available to Principal only (finance roles don't need student attendance).
router.get('/attendance', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { from, to, class_id } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });

  try {
    const params = [school_id, from, to];
    let classFilter = '';
    if (class_id) {
      params.push(class_id);
      classFilter = `AND s.class_id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT s.id AS student_id, s.name AS student_name, c.name AS class_name,
              COUNT(*) FILTER (WHERE a.status = 'present') AS days_present,
              COUNT(*) FILTER (WHERE a.status = 'absent') AS days_absent,
              COUNT(*) FILTER (WHERE a.status = 'late') AS days_late,
              COUNT(*) AS days_recorded
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN attendance a ON a.student_id = s.id AND a.date BETWEEN $2 AND $3
       WHERE s.school_id = $1 ${classFilter}
       GROUP BY s.id, s.name, c.name
       ORDER BY c.name, s.name`,
      params
    );

    await pool.query(
      `INSERT INTO report_generations (school_id, report_type, generated_by, date_from, date_to)
       VALUES ($1, 'attendance', $2, $3, $4)`,
      [school_id, req.user.teacher_id || null, from, to]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Attendance report error:', err);
    res.status(500).json({ error: 'Failed to generate attendance report' });
  }
});

// Fee collection summary — cash vs online, by date range.
router.get('/fees', requireAuth, requireFinance, async (req, res) => {
  const school_id = req.user.school_id;
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });

  try {
    const result = await pool.query(
      `SELECT h.id, s.name AS student_name, h.amount_paid, h.payment_mode, h.remarks,
              h.created_at
       FROM student_payment_history h
       JOIN students s ON s.id = h.student_id
       WHERE h.school_id = $1 AND h.created_at::date BETWEEN $2 AND $3
       ORDER BY h.created_at DESC`,
      [school_id, from, to]
    );

    const totals = result.rows.reduce(
      (acc, row) => {
        acc.total += parseFloat(row.amount_paid);
        if (row.payment_mode === 'cash') acc.cash += parseFloat(row.amount_paid);
        else acc.online += parseFloat(row.amount_paid);
        return acc;
      },
      { total: 0, cash: 0, online: 0 }
    );

    await pool.query(
      `INSERT INTO report_generations (school_id, report_type, generated_by, date_from, date_to)
       VALUES ($1, 'fees', $2, $3, $4)`,
      [school_id, req.user.teacher_id || null, from, to]
    );

    res.json({ rows: result.rows, totals });
  } catch (err) {
    console.error('Fees report error:', err);
    res.status(500).json({ error: 'Failed to generate fees report' });
  }
});

// Payroll register — one row per teacher for the given month.
router.get('/payroll', requireAuth, requireFinance, async (req, res) => {
  const school_id = req.user.school_id;
  const { month } = req.query; // format: YYYY-MM
  if (!month) return res.status(400).json({ error: 'month (YYYY-MM) is required' });

  try {
    const result = await pool.query(
      `SELECT t.name AS teacher_name, h.amount_paid, h.status, h.paid_on
       FROM teacher_salary_history h
       JOIN teachers t ON t.id = h.teacher_id
       WHERE h.school_id = $1 AND h.period = $2
       ORDER BY t.name`,
      [school_id, month]
    );

    await pool.query(
      `INSERT INTO report_generations (school_id, report_type, generated_by)
       VALUES ($1, 'payroll', $2)`,
      [school_id, req.user.teacher_id || null]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Payroll report error:', err);
    res.status(500).json({ error: 'Failed to generate payroll report' });
  }
});

export default router;
