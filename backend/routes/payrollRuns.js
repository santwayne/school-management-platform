import express from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { registerAction } from '../services/opsService.js';
import { preparePayroll, approvePayroll, payslipPdf } from '../services/payrollService.js';

const router = express.Router();
router.use(requireAuth);

const canManage = (u) => ['principal', 'accountant', 'operator'].includes(u?.role);
const guard = (req, res, next) => (canManage(req.user) ? next() : res.status(403).json({ error: 'Principal, accountant or operator role required' }));
const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

registerAction('payroll.approve', ({ params, user }) => approvePayroll(user.school_id, params.run_id, user));

router.get('/', guard, async (req, res) => {
  const r = await pool.query(`SELECT id, period, status, working_days, totals, anomalies, approved_at FROM payroll_runs WHERE school_id = $1 ORDER BY period DESC`, [req.user.school_id]);
  res.json(r.rows);
});

router.post('/prepare', guard, async (req, res) => {
  try {
    res.status(201).json(await preparePayroll(req.user.school_id, req.body?.period));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/:id', guard, async (req, res) => {
  const run = await pool.query(`SELECT * FROM payroll_runs WHERE id = $1 AND school_id = $2`, [req.params.id, req.user.school_id]);
  if (!run.rowCount) return res.status(404).json({ error: 'Not found' });
  const slips = await pool.query(
    `SELECT p.id, p.teacher_id, t.name, t.role, p.gross, p.deductions, p.net_pay, p.breakdown, p.notified_at FROM payslips p JOIN teachers t ON t.id = p.teacher_id WHERE p.payroll_run_id = $1 ORDER BY t.name`,
    [run.rows[0].id]
  );
  res.json({ ...run.rows[0], payslips: slips.rows });
});

router.post('/:id/approve', async (req, res) => {
  try {
    res.json(await approvePayroll(req.user.school_id, Number(req.params.id), req.user));
  } catch (err) {
    fail(res, err);
  }
});

// Bank transfer file for the accountant (approved runs only).
router.get('/:id/bank.csv', guard, async (req, res) => {
  const run = await pool.query(`SELECT period, status FROM payroll_runs WHERE id = $1 AND school_id = $2`, [req.params.id, req.user.school_id]);
  if (!run.rowCount) return res.status(404).json({ error: 'Not found' });
  if (run.rows[0].status !== 'approved') return res.status(409).json({ error: 'Approve the payroll first' });
  const r = await pool.query(
    `SELECT t.name, t.bank_account_name, t.bank_account_number, t.bank_ifsc, p.net_pay FROM payslips p JOIN teachers t ON t.id = p.teacher_id WHERE p.payroll_run_id = $1 ORDER BY t.name`,
    [req.params.id]
  );
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Name', 'Account holder', 'Account number', 'IFSC', 'Amount', 'Narration'].map(esc).join(',')];
  for (const row of r.rows) lines.push([row.name, row.bank_account_name || row.name, row.bank_account_number, row.bank_ifsc, Number(row.net_pay).toFixed(2), `Salary ${run.rows[0].period}`].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="salary-${run.rows[0].period}.csv"`);
  res.send(lines.join('\n'));
});

// A staff member's own payslip history across every approved run — the
// list view "my-payslips" that was missing alongside the existing
// per-payslip PDF download. Draft (unapproved) runs are excluded: a
// staff member shouldn't see a number that could still change before
// the principal approves it.
router.get('/my-payslips', async (req, res) => {
  const r = await pool.query(
    `SELECT p.id, r.period, r.status, p.gross, p.deductions, p.net_pay, p.notified_at
     FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id
     WHERE p.teacher_id = $1 AND p.school_id = $2 AND r.status = 'approved'
     ORDER BY r.period DESC`,
    [req.user.teacher_id, req.user.school_id]
  );
  res.json(r.rows);
});

// A staff member can download their own payslip; managers can download any.
router.get('/payslips/:id/pdf', async (req, res) => {
  try {
    const pdf = await payslipPdf(Number(req.params.id), req.user.school_id);
    if (!pdf) return res.status(404).json({ error: 'Not found' });
    if (!canManage(req.user) && pdf.teacherId !== req.user.teacher_id) return res.status(403).json({ error: 'Not your payslip' });
    const run = await pool.query(`SELECT r.status FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id WHERE p.id = $1`, [req.params.id]);
    if (!canManage(req.user) && run.rows[0]?.status !== 'approved') return res.status(403).json({ error: 'Payslip not released yet' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
    res.send(pdf.buffer);
  } catch (err) {
    fail(res, err);
  }
});

// Salary components (allowances / deductions).
router.get('/config/components', guard, async (req, res) => {
  const r = await pool.query(`SELECT c.*, t.name AS teacher_name FROM salary_components c LEFT JOIN teachers t ON t.id = c.teacher_id WHERE c.school_id = $1 ORDER BY c.kind, c.name`, [req.user.school_id]);
  res.json(r.rows);
});
router.post('/config/components', guard, async (req, res) => {
  const { name, kind, calc, value, teacher_id } = req.body || {};
  if (!name || !['earning', 'deduction'].includes(kind) || !['fixed', 'percent_of_base'].includes(calc) || !(Number(value) >= 0)) {
    return res.status(400).json({ error: 'name, kind (earning|deduction), calc (fixed|percent_of_base) and a non-negative value are required' });
  }
  if (calc === 'percent_of_base' && Number(value) > 100) return res.status(400).json({ error: 'Percentage cannot exceed 100' });
  const r = await pool.query(
    `INSERT INTO salary_components (school_id, teacher_id, name, kind, calc, value) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.school_id, teacher_id || null, String(name).slice(0, 60), kind, calc, value]
  );
  res.status(201).json(r.rows[0]);
});
router.delete('/config/components/:id', guard, async (req, res) => {
  await pool.query(`UPDATE salary_components SET active = FALSE WHERE id = $1 AND school_id = $2`, [req.params.id, req.user.school_id]);
  res.json({ ok: true });
});

export default router;
