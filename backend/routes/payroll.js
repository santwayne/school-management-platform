import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireFinance } from '../middleware/auth.js';

const router = express.Router();

// POST /api/payroll/salary — set/update a teacher's monthly salary
router.post('/salary', requireAuth, requireFinance, async (req, res) => {
  const { teacher_id, monthly_amount } = req.body;
  const schoolId = req.user.school_id;

  if (!teacher_id || !monthly_amount) {
    return res.status(400).json({ error: 'teacher_id and monthly_amount are required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO teacher_salary (school_id, teacher_id, monthly_amount)
       VALUES ($1, $2, $3)
       ON CONFLICT (teacher_id) DO UPDATE SET monthly_amount = EXCLUDED.monthly_amount
       RETURNING *`,
      [schoolId, teacher_id, monthly_amount]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payroll/salary — list current salary for every teacher
router.get('/salary', requireAuth, requireFinance, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id AS teacher_id, t.name, ts.monthly_amount
       FROM teachers t
       LEFT JOIN teacher_salary ts ON ts.teacher_id = t.id
       WHERE t.school_id = $1 AND t.role != 'principal'
       ORDER BY t.name ASC`,
      [req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payroll/run — body { period: '2026-07' }, generates one PENDING
// row per active teacher who has a salary set and no row yet for that period.
// Safe to re-run — skips teachers who already have a row.
router.post('/run', requireAuth, requireFinance, async (req, res) => {
  const { period } = req.body;
  const schoolId = req.user.school_id;

  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return res.status(400).json({ error: "period is required, format 'YYYY-MM'" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO teacher_salary_history (school_id, teacher_id, period, amount_paid, status)
       SELECT ts.school_id, ts.teacher_id, $1, ts.monthly_amount, 'PENDING'
       FROM teacher_salary ts
       WHERE ts.school_id = $2
       ON CONFLICT (teacher_id, period) DO NOTHING
       RETURNING *`,
      [period, schoolId]
    );
    res.status(201).json({ success: true, generated_count: result.rowCount, rows: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/payroll/:id/mark-paid
router.patch('/:id/mark-paid', requireAuth, requireFinance, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE teacher_salary_history SET status = 'PAID', paid_on = CURRENT_DATE
       WHERE id = $1 AND school_id = $2 RETURNING *`,
      [id, req.user.school_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Payroll row not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payroll?period=2026-07 — payroll history for a month
router.get('/', requireAuth, requireFinance, async (req, res) => {
  const { period } = req.query;
  const schoolId = req.user.school_id;

  try {
    const params = [schoolId];
    let where = 'h.school_id = $1';
    if (period) {
      params.push(period);
      where += ` AND h.period = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT h.*, t.name AS teacher_name
       FROM teacher_salary_history h
       JOIN teachers t ON h.teacher_id = t.id
       WHERE ${where}
       ORDER BY h.period DESC, t.name ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
