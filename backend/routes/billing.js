import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

const PLAN_DETAILS = {
  starter: { name: 'Starter', price: 4999, student_limit: 100, accountant_seats: 0 },
  growth: { name: 'Growth', price: 12999, student_limit: 500, accountant_seats: 2 },
  district: { name: 'District', price: 29999, student_limit: 999999, accountant_seats: 10 },
};

// Current plan + live usage, for the Principal's own billing page (separate
// from the Super Admin's cross-school billing view).
router.get('/', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const schoolRes = await pool.query('SELECT plan, plan_renews_at FROM schools WHERE id = $1', [school_id]);
    if (schoolRes.rowCount === 0) return res.status(404).json({ error: 'School not found' });

    const plan = schoolRes.rows[0].plan || 'starter';
    const planInfo = PLAN_DETAILS[plan] || PLAN_DETAILS.starter;

    const studentCountRes = await pool.query('SELECT COUNT(*) FROM students WHERE school_id = $1', [school_id]);
    const staffCountRes = await pool.query('SELECT COUNT(*) FROM teachers WHERE school_id = $1', [school_id]);
    const accountantCountRes = await pool.query(
      `SELECT COUNT(*) FROM teachers WHERE school_id = $1 AND role = 'accountant'`,
      [school_id]
    );

    res.json({
      plan,
      plan_name: planInfo.name,
      price: planInfo.price,
      renews_at: schoolRes.rows[0].plan_renews_at,
      usage: {
        students: { used: parseInt(studentCountRes.rows[0].count, 10), limit: planInfo.student_limit },
        staff: { used: parseInt(staffCountRes.rows[0].count, 10), limit: null },
        accountant_seats: { used: parseInt(accountantCountRes.rows[0].count, 10), limit: planInfo.accountant_seats },
      },
      all_plans: PLAN_DETAILS,
    });
  } catch (err) {
    console.error('Billing fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch billing info' });
  }
});

// Change plan. NOTE: this only updates the DB flag — it does not itself
// charge anything or talk to Razorpay/Stripe. Wire actual payment collection
// in before this is exposed as a self-serve upgrade button in production;
// right now it's a request that should route to a human/sales flow, or a
// webhook-driven update once real billing is wired.
router.patch('/plan', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { plan } = req.body;
  if (!PLAN_DETAILS[plan]) {
    return res.status(400).json({ error: 'Invalid plan. Must be starter, growth, or district' });
  }
  try {
    const result = await pool.query(
      `UPDATE schools SET plan = $1, plan_renews_at = CURRENT_DATE + INTERVAL '30 days' WHERE id = $2 RETURNING plan, plan_renews_at`,
      [plan, school_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Plan update error:', err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

export default router;
