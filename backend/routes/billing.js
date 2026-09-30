import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';
import { razorpayClient } from './paymentLinks.js';

const router = express.Router();

const PLAN_DETAILS = {
  starter: { name: 'Starter', price: 4999, student_limit: 100, accountant_seats: 0 },
  growth: { name: 'Growth', price: 12999, student_limit: 500, accountant_seats: 2 },
  district: { name: 'District', price: 29999, student_limit: 999999, accountant_seats: 10 },
};

// A Razorpay "Plan" is a merchant-configured product-catalog entity —
// created once via the Razorpay Dashboard (or API, out-of-band), not
// something this app creates per subscription request. Mapped here via env
// var rather than a DB column since there's exactly one per plan tier,
// account-wide, not per-school.
const RAZORPAY_PLAN_ID = {
  starter: process.env.RAZORPAY_PLAN_ID_STARTER,
  growth: process.env.RAZORPAY_PLAN_ID_GROWTH,
  district: process.env.RAZORPAY_PLAN_ID_DISTRICT,
};

// Current plan + live usage, for the Principal's own billing page (separate
// from the Super Admin's cross-school billing view).
router.get('/', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    const schoolRes = await pool.query(
      'SELECT plan, plan_renews_at, billing_status, razorpay_subscription_id FROM schools WHERE id = $1',
      [school_id]
    );
    if (schoolRes.rowCount === 0) return res.status(404).json({ error: 'School not found' });

    const plan = schoolRes.rows[0].plan || 'starter';
    const planInfo = PLAN_DETAILS[plan] || PLAN_DETAILS.starter;

    // Demo rows (Super Admin's "Generate demo users" tool marks these
    // is_demo = TRUE) must not count against a school's real plan/seat
    // usage — same exclusion payrollService.js already applies for payroll.
    const studentCountRes = await pool.query(
      `SELECT COUNT(*) FROM students WHERE school_id = $1 AND is_demo = FALSE`,
      [school_id]
    );
    const staffCountRes = await pool.query(
      `SELECT COUNT(*) FROM teachers WHERE school_id = $1 AND is_demo = FALSE`,
      [school_id]
    );
    const accountantCountRes = await pool.query(
      `SELECT COUNT(*) FROM teachers WHERE school_id = $1 AND role = 'accountant' AND is_demo = FALSE`,
      [school_id]
    );

    res.json({
      plan,
      plan_name: planInfo.name,
      price: planInfo.price,
      renews_at: schoolRes.rows[0].plan_renews_at,
      billing_status: schoolRes.rows[0].billing_status || 'active',
      has_subscription: !!schoolRes.rows[0].razorpay_subscription_id,
      plans_payable_online: Object.keys(RAZORPAY_PLAN_ID).filter((k) => !!RAZORPAY_PLAN_ID[k]),
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

// POST /api/billing/subscribe — real, recurring, principal-initiated
// payment via Razorpay Subscriptions. Creates (or reuses) a subscription
// against the merchant's pre-configured Razorpay Plan for this tier, and
// hands back the hosted `short_url` for the principal to authorize the
// mandate right now — deliberately not relying on Razorpay's own
// email/SMS notification (customer_notify: 0), since the principal is
// already on this page and can just be redirected straight there. The
// actual plan flip only happens later, on the webhook's
// `subscription.activated` event below — never here — since the mandate
// isn't actually authorized (or charged) until the principal completes
// that hosted page.
router.post('/subscribe', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { plan } = req.body;
  if (!PLAN_DETAILS[plan]) {
    return res.status(400).json({ error: 'Invalid plan. Must be starter, growth, or district' });
  }
  const razorpayPlanId = RAZORPAY_PLAN_ID[plan];
  if (!razorpayPlanId) {
    return res.status(400).json({
      error: `Online payment isn't set up yet for the ${PLAN_DETAILS[plan].name} plan — contact support to subscribe.`,
    });
  }

  try {
    const schoolRes = await pool.query('SELECT name FROM schools WHERE id = $1', [school_id]);
    if (schoolRes.rowCount === 0) return res.status(404).json({ error: 'School not found' });

    // Razorpay requires an explicit total_count of billing cycles — there's
    // no "indefinite" option on the API itself. 120 monthly cycles (10
    // years) is a real constraint of Razorpay Subscriptions, not a product
    // decision to cap how long a school can stay subscribed; renews on its
    // own well before that via subscription.charged, same as any month.
    const razorRes = await razorpayClient().post('/subscriptions', {
      plan_id: razorpayPlanId,
      customer_notify: 0,
      total_count: 120,
      notes: { school_id: String(school_id), plan },
    });

    await pool.query(
      `UPDATE schools SET razorpay_subscription_id = $1, billing_status = 'pending_activation' WHERE id = $2`,
      [razorRes.data.id, school_id]
    );

    res.status(201).json({ subscription_id: razorRes.data.id, short_url: razorRes.data.short_url });
  } catch (err) {
    console.error('Subscription create error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to start subscription' });
  }
});

// Change plan WITHOUT charging anything — a manual/support override for
// Super Admin use (comping a school, fixing billing_status after a support
// call), now that POST /subscribe above is the real self-serve payment
// path. Left in place rather than removed since other flows may still rely
// on being able to flip a plan without going through Razorpay.
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
