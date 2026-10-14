import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireFinance } from '../middleware/auth.js';
import { audit } from '../services/opsService.js';

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
      `SELECT t.id AS teacher_id, t.name, t.role, ts.monthly_amount AS own_amount, rs.monthly_amount AS role_amount,
              COALESCE(ts.monthly_amount, rs.monthly_amount) AS monthly_amount,
              (ts.monthly_amount IS NULL AND rs.monthly_amount IS NOT NULL) AS from_role
       FROM teachers t
       LEFT JOIN teacher_salary ts ON ts.teacher_id = t.id
       LEFT JOIN role_salary_structures rs ON rs.school_id = t.school_id AND rs.role = t.role
       WHERE t.school_id = $1 AND t.role != 'principal'
       ORDER BY t.name ASC`,
      [req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export const SALARY_ROLES = ['teacher', 'accountant', 'librarian', 'operator', 'principal'];

// GET /api/payroll/role-structure — the base monthly salary set for each staff
// role, with how many staff are in the role.
router.get('/role-structure', requireAuth, requireFinance, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.role, rs.monthly_amount,
              (SELECT COUNT(*)::int FROM teachers t WHERE t.school_id = $1 AND t.role = r.role) AS staff_count
         FROM unnest($2::text[]) AS r(role)
         LEFT JOIN role_salary_structures rs ON rs.school_id = $1 AND rs.role = r.role`,
      [req.user.school_id, SALARY_ROLES]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/payroll/role-structure — body { role, monthly_amount }. A blank /
// null amount removes the role's structure. Staff with their own salary on the
// Salaries tab keep it; everyone else in the role gets this amount.
router.put('/role-structure', requireAuth, requireFinance, async (req, res) => {
  const { role, monthly_amount } = req.body || {};
  if (!SALARY_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${SALARY_ROLES.join(', ')}` });
  const clearing = monthly_amount === null || monthly_amount === '' || monthly_amount === undefined;
  const amount = Number(monthly_amount);
  if (!clearing && (!Number.isFinite(amount) || amount < 0 || amount > 10000000)) {
    return res.status(400).json({ error: 'monthly_amount must be a non-negative number' });
  }
  try {
    if (clearing) {
      await pool.query('DELETE FROM role_salary_structures WHERE school_id = $1 AND role = $2', [req.user.school_id, role]);
    } else {
      await pool.query(
        `INSERT INTO role_salary_structures (school_id, role, monthly_amount) VALUES ($1, $2, $3)
         ON CONFLICT (school_id, role) DO UPDATE SET monthly_amount = EXCLUDED.monthly_amount, updated_at = CURRENT_TIMESTAMP`,
        [req.user.school_id, role, amount]
      );
    }
    await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'payroll.role_structure', entityType: 'role_salary_structures', detail: { role, monthly_amount: clearing ? null : amount } });
    res.json({ role, monthly_amount: clearing ? null : amount });
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
       SELECT t.school_id, t.id, $1::varchar, eff.amount, 'PENDING'
       FROM teachers t
       LEFT JOIN teacher_salary ts ON ts.teacher_id = t.id
       LEFT JOIN role_salary_structures rs ON rs.school_id = t.school_id AND rs.role = t.role
       CROSS JOIN LATERAL (SELECT COALESCE(ts.monthly_amount, rs.monthly_amount) AS amount) eff
       WHERE t.school_id = $2 AND eff.amount IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM teacher_salary_history h WHERE h.teacher_id = t.id AND h.period = $1::varchar
         )
       RETURNING *`,
      [period, schoolId]
    );
    // Re-running refreshes still-unpaid rows to the current salary. Without
    // this, a salary changed after the first run (e.g. ₹12,669 → ₹14,000)
    // stayed at the old snapshot forever. PAID rows are never touched.
    const refreshed = await pool.query(
      `UPDATE teacher_salary_history h
       SET amount_paid = eff.amount
       FROM teachers t
       LEFT JOIN teacher_salary ts ON ts.teacher_id = t.id
       LEFT JOIN role_salary_structures rs ON rs.school_id = t.school_id AND rs.role = t.role
       CROSS JOIN LATERAL (SELECT COALESCE(ts.monthly_amount, rs.monthly_amount) AS amount) eff
       WHERE t.id = h.teacher_id AND h.school_id = $2 AND h.period = $1::varchar
         AND h.status = 'PENDING' AND eff.amount IS NOT NULL AND h.amount_paid IS DISTINCT FROM eff.amount
       RETURNING h.id, h.teacher_id, h.amount_paid`,
      [period, schoolId]
    );
    if (result.rowCount > 0 || refreshed.rowCount > 0) {
      await audit({ schoolId, actorType: 'user', actorId: req.user.teacher_id, action: 'payroll.run', entityType: 'teacher_salary_history', detail: { period, generated_count: result.rowCount, refreshed_count: refreshed.rowCount } });
    }
    res.status(201).json({ success: true, generated_count: result.rowCount, refreshed_count: refreshed.rowCount, rows: result.rows });
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
    await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'payroll.marked_paid', entityType: 'teacher_salary_history', entityId: result.rows[0].id, detail: { period: result.rows[0].period, teacher_id: result.rows[0].teacher_id } });
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
