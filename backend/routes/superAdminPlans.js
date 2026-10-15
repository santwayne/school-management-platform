import express from 'express';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import {
  PlanError, planOverview, getSchoolPlan, quote, startDemo, extendDemo, recordPayment,
  changePlan, cancelDowngrade, updatePlanRates, sweepPlans,
} from '../services/schoolPlans.js';

// Super Admin: Core (₹400) / AI (₹650) plans per school.
// Mounted at /api/super-admin/plans.
const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

const send = (res, err, fallback) => {
  if (err instanceof PlanError) return res.status(err.statusCode).json({ error: err.message });
  console.error(`[plans] ${fallback}:`, err.message);
  return res.status(500).json({ error: fallback });
};
const actor = (req) => req.user.super_admin_id;
const sid = (req) => Number(req.params.id);

// Counts + every school with its plan, state, students and dates.
router.get('/', async (req, res) => {
  try { res.json(await planOverview()); } catch (err) { send(res, err, 'Failed to load plans'); }
});

// Price for a plan: ?plan=core|ai&students=N[&school_id=X] (adds the
// mid-year upgrade difference when the school is on paid Core).
router.get('/quote', async (req, res) => {
  try {
    res.json(await quote({ schoolId: req.query.school_id ? Number(req.query.school_id) : null, planCode: req.query.plan, students: req.query.students }));
  } catch (err) { send(res, err, 'Failed to make quote'); }
});

// Per-student rate and yearly minimum for Core / AI.
router.patch('/catalog/:code', async (req, res) => {
  try {
    const { per_student_yearly, min_yearly, reason } = req.body || {};
    res.json(await updatePlanRates({ code: req.params.code, perStudentYearly: per_student_yearly, minYearly: min_yearly, reason, actorId: actor(req) }));
  } catch (err) { send(res, err, 'Failed to update plan'); }
});

router.get('/schools/:id', async (req, res) => {
  try { res.json(await getSchoolPlan(sid(req))); } catch (err) { send(res, err, 'Failed to load school plan'); }
});

router.post('/schools/:id/demo', async (req, res) => {
  try {
    res.json(await startDemo({ schoolId: sid(req), days: req.body?.days ?? 14, note: req.body?.note, actorId: actor(req) }));
  } catch (err) { send(res, err, 'Failed to start demo'); }
});

router.post('/schools/:id/demo/extend', async (req, res) => {
  try {
    res.json(await extendDemo({ schoolId: sid(req), days: req.body?.days, note: req.body?.note, actorId: actor(req) }));
  } catch (err) { send(res, err, 'Failed to extend demo'); }
});

// Body: { plan, students, amount (₹ before GST), period_start?, period_end?, method, reference?, note? }
router.post('/schools/:id/payment', async (req, res) => {
  try {
    const b = req.body || {};
    res.json(await recordPayment({
      schoolId: sid(req), planCode: b.plan, students: b.students, amount: b.amount,
      periodStart: b.period_start || null, periodEnd: b.period_end || null,
      method: b.method, reference: b.reference, note: b.note, actorId: actor(req),
    }));
  } catch (err) { send(res, err, 'Failed to record payment'); }
});

// Body: { to_plan: 'core' | 'ai', note? } — upgrade now, downgrade at paid-year end.
router.post('/schools/:id/change', async (req, res) => {
  try {
    res.json(await changePlan({ schoolId: sid(req), toPlan: req.body?.to_plan, note: req.body?.note, actorId: actor(req) }));
  } catch (err) { send(res, err, 'Failed to change plan'); }
});

router.post('/schools/:id/cancel-downgrade', async (req, res) => {
  try {
    res.json(await cancelDowngrade({ schoolId: sid(req), note: req.body?.note, actorId: actor(req) }));
  } catch (err) { send(res, err, 'Failed to cancel downgrade'); }
});

// Run the expiry / downgrade sweep now (it also runs every few minutes).
router.post('/sweep', async (req, res) => {
  try { res.json(await sweepPlans()); } catch (err) { send(res, err, 'Sweep failed'); }
});

export default router;
