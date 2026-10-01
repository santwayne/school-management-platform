import express from 'express';
import PDFDocument from 'pdfkit';
import pool from '../config/db.js';
import { requireAuth, requireFinance, requireBillingOwner, requireSuperAdmin } from '../middleware/auth.js';
import { getPlans, getUsage, quoteChange, startCheckout, cancelAtPeriodEnd, processBillingEvent } from '../services/billingService.js';
import { withGst, isReadOnly } from '../services/billingMath.js';
import { verifyCheckoutSignature } from '../utils/razorpay.js';
import { audit } from '../services/opsService.js';
import {
  keyMode, validatePlanPatch, razorpayPlanProblems, listPlansForAdmin, fetchRazorpayPlan, createRazorpayPlan,
  logPlanChange, listPlanAudit,
} from '../services/planAdmin.js';

const router = express.Router();

const sendErr = (res, err, fallback) => {
  if (err.statusCode) return res.status(err.statusCode).json({ error: err.message, code: err.code, blockers: err.blockers });
  console.error(fallback, err.response?.data || err);
  return res.status(500).json({ error: fallback });
};

// Current plan, usage, status — Principal and Accountant can view.
router.get('/', requireAuth, requireFinance, async (req, res) => {
  const schoolId = req.user.school_id;
  try {
    const s = (await pool.query(
      `SELECT plan, plan_renews_at, billing_status, billing_grace_until, current_period_end, pending_plan_code,
              current_subscription_id, billing_gstin, billing_legal_name, billing_address, billing_state_code
       FROM schools WHERE id = $1`, [schoolId])).rows[0];
    if (!s) return res.status(404).json({ error: 'School not found' });
    const plans = await getPlans();
    const plan = plans[s.plan] || plans.starter;
    const usage = await getUsage(schoolId);
    const sub = s.current_subscription_id
      ? (await pool.query(`SELECT billing_cycle, status, cancel_at_period_end, current_period_end FROM subscriptions WHERE id = $1`, [s.current_subscription_id])).rows[0]
      : null;
    const awaiting = (await pool.query(
      // An unpaid checkout ('created') only counts as "awaiting payment" for 30
      // minutes — a closed Razorpay window shouldn't leave the banner up for good.
      `SELECT id, plan_code, kind, status FROM subscriptions
       WHERE school_id = $1 AND (status = 'authenticated' OR (status = 'created' AND created_at > NOW() - INTERVAL '30 minutes'))
       ORDER BY id DESC LIMIT 1`,
      [schoolId])).rows[0] || null;

    res.json({
      plan: plan.code,
      plan_name: plan.name,
      price: plan.price_paise / 100,
      price_with_gst: withGst(plan.price_paise) / 100,
      billing_status: s.billing_status,
      read_only: isReadOnly(s),
      grace_until: s.billing_grace_until,
      renews_at: s.current_period_end || s.plan_renews_at,
      pending_plan: s.pending_plan_code,
      subscription: sub,
      awaiting_payment: awaiting,
      can_manage: req.user.role === 'principal',
      billing_details: { gstin: s.billing_gstin, legal_name: s.billing_legal_name, address: s.billing_address, state_code: s.billing_state_code },
      usage: {
        students: { used: usage.students, limit: plan.student_limit },
        staff: { used: usage.staff, limit: null },
      },
      all_plans: Object.fromEntries(Object.values(plans).map((p) => [p.code, {
        name: p.name, price: p.price_paise / 100, yearly_price: p.yearly_price_paise ? p.yearly_price_paise / 100 : null,
        student_limit: p.student_limit, rank: p.rank,
        monthly_online: !!p.razorpay_plan_id, yearly_online: !!p.yearly_price_paise,
      }])),
    });
  } catch (err) {
    sendErr(res, err, 'Failed to fetch billing info');
  }
});

// Price breakdown for the checkout modal (list price, 18% GST, proration,
// when the change applies). Creates nothing.
router.get('/quote', requireAuth, requireBillingOwner, async (req, res) => {
  try {
    const { _internal, ...q } = await quoteChange({ schoolId: req.user.school_id, planCode: req.query.plan, cycle: req.query.cycle || 'monthly' });
    res.json(q);
  } catch (err) {
    sendErr(res, err, 'Failed to price this plan');
  }
});

// Starts payment. Returns Razorpay Checkout options. Does NOT change the plan —
// only the verified webhook does (services/billingService.js).
router.post('/checkout', requireAuth, requireBillingOwner, async (req, res) => {
  try {
    const out = await startCheckout({
      schoolId: req.user.school_id, teacherId: req.user.teacher_id, planCode: req.body.plan, cycle: req.body.cycle || 'monthly',
    });
    res.status(201).json(out);
  } catch (err) {
    sendErr(res, err, 'Failed to start checkout');
  }
});
// Back-compat for the PR #52 frontend; same behaviour, monthly only.
router.post('/subscribe', requireAuth, requireBillingOwner, async (req, res) => {
  try {
    res.status(201).json(await startCheckout({ schoolId: req.user.school_id, teacherId: req.user.teacher_id, planCode: req.body.plan, cycle: 'monthly' }));
  } catch (err) {
    sendErr(res, err, 'Failed to start checkout');
  }
});

// Checkout handler callback → verify the signature, then let the UI poll
// /status. Still NOT authoritative for the plan; it just tells us the
// browser-side payment finished so we can show "Activating…".
router.post('/checkout/confirm', requireAuth, requireBillingOwner, async (req, res) => {
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_order_id, razorpay_signature } = req.body || {};
  const ok = verifyCheckoutSignature({
    paymentId: razorpay_payment_id, subscriptionId: razorpay_subscription_id, orderId: razorpay_order_id, signature: razorpay_signature,
  });
  if (!ok) return res.status(400).json({ error: 'Payment signature could not be verified' });
  const own = await pool.query(
    `SELECT id FROM subscriptions WHERE school_id = $1 AND (razorpay_subscription_id = $2 OR razorpay_order_id = $3)`,
    [req.user.school_id, razorpay_subscription_id || null, razorpay_order_id || null]
  );
  if (!own.rowCount) return res.status(404).json({ error: 'Unknown checkout' });
  res.json({ status: 'verifying', subscription_row_id: own.rows[0].id });
});

// Polled by the "Activating…" state until the webhook has landed.
router.get('/checkout/:id/status', requireAuth, requireFinance, async (req, res) => {
  const r = await pool.query(
    `SELECT sub.status, sub.kind, sub.plan_code, s.plan, s.pending_plan_code FROM subscriptions sub JOIN schools s ON s.id = sub.school_id
     WHERE sub.id = $1 AND sub.school_id = $2`, [req.params.id, req.user.school_id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
  const x = r.rows[0];
  const done = x.status === 'active'
    || (x.kind === 'upgrade' && x.status === 'authenticated' && x.plan === x.plan_code)
    || (x.kind === 'downgrade' && x.pending_plan_code === x.plan_code);
  res.json({ status: done ? 'done' : x.status, kind: x.kind, plan: x.plan, pending_plan: x.pending_plan_code });
});

router.post('/cancel', requireAuth, requireBillingOwner, async (req, res) => {
  try {
    res.json(await cancelAtPeriodEnd({ schoolId: req.user.school_id, teacherId: req.user.teacher_id }));
  } catch (err) {
    sendErr(res, err, 'Failed to cancel');
  }
});

// GST details printed on invoices (buyer GSTIN, legal name, state for CGST/SGST vs IGST).
router.put('/details', requireAuth, requireBillingOwner, async (req, res) => {
  const { gstin, legal_name, address, state_code } = req.body || {};
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return res.status(400).json({ error: 'GSTIN format looks wrong' });
  if (state_code && !/^\d{2}$/.test(state_code)) return res.status(400).json({ error: 'state_code must be the 2-digit GST state code' });
  const sc = state_code || (gstin ? gstin.slice(0, 2) : null);
  await pool.query(
    `UPDATE schools SET billing_gstin = $2, billing_legal_name = $3, billing_address = $4, billing_state_code = $5 WHERE id = $1`,
    [req.user.school_id, gstin || null, legal_name || null, address || null, sc]
  );
  res.json({ ok: true });
});

router.get('/invoices', requireAuth, requireFinance, async (req, res) => {
  const r = await pool.query(
    `SELECT id, invoice_number, description, total_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, issued_at, period_start, period_end
     FROM invoices WHERE school_id = $1 ORDER BY issued_at DESC LIMIT 100`, [req.user.school_id]);
  res.json(r.rows);
});

const rupees = (p) => `Rs. ${(Number(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

router.get('/invoices/:id/pdf', requireAuth, requireFinance, async (req, res) => {
  const r = await pool.query(`SELECT * FROM invoices WHERE id = $1 AND school_id = $2`, [req.params.id, req.user.school_id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Invoice not found' });
  const inv = r.rows[0];
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.invoice_number.replace(/\//g, '-')}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  doc.fontSize(18).text('TAX INVOICE', { align: 'right' });
  doc.moveDown(0.5).fontSize(11).text(process.env.WAYNUR_LEGAL_NAME || 'Wayne E Solutions (Waynur)');
  doc.fontSize(9).text(process.env.WAYNUR_ADDRESS || '').text(`GSTIN: ${process.env.WAYNUR_GSTIN || '—'}`).text(`State code: ${process.env.WAYNUR_STATE_CODE || '03'}`);
  doc.moveDown().fontSize(10)
    .text(`Invoice no: ${inv.invoice_number}`).text(`Date: ${new Date(inv.issued_at).toLocaleDateString('en-IN')}`)
    .text(`Razorpay payment: ${inv.razorpay_payment_id || '—'}`);
  doc.moveDown().fontSize(10).text('Billed to:', { underline: true })
    .text(inv.buyer_name || '').text(inv.buyer_address || '').text(`GSTIN: ${inv.buyer_gstin || 'Unregistered'}`)
    .text(`Place of supply (state code): ${inv.place_of_supply || '—'}`);
  doc.moveDown().text(`${inv.description}`).text(`SAC: ${inv.sac_code}`);
  if (inv.period_start && inv.period_end) {
    doc.text(`Service period: ${new Date(inv.period_start).toLocaleDateString('en-IN')} – ${new Date(inv.period_end).toLocaleDateString('en-IN')}`);
  }
  doc.moveDown();
  const line = (k, v) => doc.text(k, { continued: true }).text(v, { align: 'right' });
  line('Taxable value', rupees(inv.taxable_paise));
  if (Number(inv.igst_paise)) line('IGST @ 18%', rupees(inv.igst_paise));
  else { line('CGST @ 9%', rupees(inv.cgst_paise)); line('SGST @ 9%', rupees(inv.sgst_paise)); }
  doc.font('Helvetica-Bold'); line('Total', rupees(inv.total_paise)); doc.font('Helvetica');
  doc.moveDown(2).fontSize(8).fillColor('#666').text('This is a computer-generated invoice and does not require a signature.');
  doc.end();
});

// ---- Super Admin only: manual override (comp a school, fix after a support call).
// This used to be open to every principal with no payment — anyone could
// self-upgrade to District for free. Now audited and super-admin only.
router.patch('/plan', requireAuth, requireSuperAdmin, async (req, res) => {
  const { school_id, plan, reason } = req.body || {};
  const plans = await getPlans();
  if (!school_id || !plans[plan]) return res.status(400).json({ error: 'school_id and a valid plan are required' });
  if (!reason || String(reason).trim().length < 5) return res.status(400).json({ error: 'A reason is required for manual plan changes' });
  const r = await pool.query(
    `UPDATE schools SET plan = $2, student_limit = $3 WHERE id = $1 RETURNING id, plan`,
    [school_id, plan, plans[plan].student_limit]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'School not found' });
  await audit({ schoolId: school_id, actorType: 'super_admin', actorId: req.user.super_admin_id, action: 'billing.plan_override', detail: { plan, reason } });
  res.json(r.rows[0]);
});

// ---- Super Admin: plan catalog (prices, limits, Razorpay plan IDs) ----

const rzpError = (err) => err.response?.data?.error?.description || err.message;

router.get('/admin/plans', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    res.json({ mode: keyMode(), plans: await listPlansForAdmin(), history: await listPlanAudit() });
  } catch (err) { sendErr(res, err, 'Failed to load plans'); }
});

// Create the monthly Razorpay Plan for this Waynur plan (GST-inclusive) and save its ID.
router.post('/admin/plans/:code/razorpay', requireAuth, requireSuperAdmin, async (req, res) => {
  const plan = (await pool.query(`SELECT * FROM plans WHERE code = $1`, [req.params.code])).rows[0];
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  if (keyMode() === 'none') return res.status(400).json({ error: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set on the server' });
  try {
    const rzp = await createRazorpayPlan(plan);
    await pool.query(`UPDATE plans SET razorpay_plan_id = $2, updated_at = NOW() WHERE code = $1`, [plan.code, rzp.id]);
    await logPlanChange({ planCode: plan.code, actorId: req.user.super_admin_id, action: 'razorpay_plan_created',
      detail: { razorpay_plan_id: rzp.id, previous: plan.razorpay_plan_id, amount_paise: rzp.item?.amount, mode: keyMode() } });
    res.json({ razorpay_plan_id: rzp.id, plans: await listPlansForAdmin() });
  } catch (err) {
    console.error('[billing] create Razorpay plan failed:', err.response?.data || err.message);
    res.status(502).json({ error: `Razorpay rejected the plan: ${rzpError(err)}` });
  }
});

// Link an existing Razorpay Plan ID (e.g. one created in the Razorpay dashboard).
// Verified against Razorpay first. Empty value clears the DB value (falls back to .env).
router.put('/admin/plans/:code/razorpay-id', requireAuth, requireSuperAdmin, async (req, res) => {
  const plan = (await pool.query(`SELECT * FROM plans WHERE code = $1`, [req.params.code])).rows[0];
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const planId = String(req.body?.razorpay_plan_id || '').trim();
  try {
    if (planId) {
      if (!/^plan_[A-Za-z0-9]+$/.test(planId)) return res.status(400).json({ error: 'Razorpay plan IDs look like plan_XXXXXXXXXXXX' });
      if (keyMode() === 'none') return res.status(400).json({ error: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set on the server' });
      const rzp = await fetchRazorpayPlan(planId);
      if (!rzp) return res.status(400).json({ error: `${planId} was not found in Razorpay (${keyMode()} mode). Test and live plans are separate.` });
      const problems = razorpayPlanProblems(rzp, plan.price_paise);
      if (problems.length) return res.status(400).json({ error: `This Razorpay plan can't bill ${plan.name}: ${problems.join('; ')}` });
    }
    await pool.query(`UPDATE plans SET razorpay_plan_id = $2, updated_at = NOW() WHERE code = $1`, [plan.code, planId || null]);
    await logPlanChange({ planCode: plan.code, actorId: req.user.super_admin_id, action: planId ? 'razorpay_plan_linked' : 'razorpay_plan_cleared',
      detail: { razorpay_plan_id: planId || null, previous: plan.razorpay_plan_id, mode: keyMode() } });
    res.json({ plans: await listPlansForAdmin() });
  } catch (err) {
    console.error('[billing] verify Razorpay plan failed:', err.response?.data || err.message);
    res.status(502).json({ error: `Could not check the plan with Razorpay: ${rzpError(err)}` });
  }
});

// Edit name / limits / prices. A monthly price change creates a new Razorpay
// Plan first (Razorpay plans are immutable); if that fails nothing is saved.
router.patch('/admin/plans/:code', requireAuth, requireSuperAdmin, async (req, res) => {
  const plan = (await pool.query(`SELECT * FROM plans WHERE code = $1`, [req.params.code])).rows[0];
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const { changes, errors } = validatePlanPatch(req.body || {}, plan);
  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  if (!Object.keys(changes).length) return res.json({ plans: await listPlansForAdmin(), unchanged: true });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) return res.status(400).json({ error: 'Add a short reason for this change (shown in the change history)' });

  let newRzp = null;
  if (changes.price_paise !== undefined) {
    if (keyMode() === 'none') return res.status(400).json({ error: 'Changing the monthly price needs Razorpay keys on the server (a new Razorpay plan is created)' });
    try {
      newRzp = await createRazorpayPlan({ ...plan, ...changes }, changes.price_paise);
      changes.razorpay_plan_id = newRzp.id;
    } catch (err) {
      console.error('[billing] create Razorpay plan for price change failed:', err.response?.data || err.message);
      return res.status(502).json({ error: `Price not changed — Razorpay rejected the new plan: ${rzpError(err)}` });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cols = Object.keys(changes);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    await client.query(`UPDATE plans SET ${sets}, updated_at = NOW() WHERE code = $1`, [plan.code, ...cols.map((c) => changes[c])]);
    let schoolsUpdated = 0;
    if (changes.student_limit !== undefined && req.body?.apply_to_existing !== false) {
      const r = await client.query(
        `UPDATE schools SET student_limit = $2 WHERE plan = $1`,
        [plan.code, changes.student_limit]);
      schoolsUpdated = r.rowCount;
    }
    const before = Object.fromEntries(cols.map((c) => [c, plan[c]]));
    await logPlanChange({ planCode: plan.code, actorId: req.user.super_admin_id, action: 'plan_updated',
      detail: { before, after: changes, reason, schools_updated: schoolsUpdated, mode: keyMode() } }, client);
    await client.query('COMMIT');
    res.json({ plans: await listPlansForAdmin(), schools_updated: schoolsUpdated, new_razorpay_plan_id: newRzp?.id || null });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendErr(res, err, 'Failed to update plan');
  } finally {
    client.release();
  }
});

// Super Admin: re-run a stuck webhook event.
router.post('/events/:id/retry', requireAuth, requireSuperAdmin, async (req, res) => {
  await pool.query(`UPDATE billing_events SET status = 'failed' WHERE id = $1 AND status <> 'processed'`, [req.params.id]);
  try { res.json({ result: await processBillingEvent(req.params.id) }); } catch (err) { sendErr(res, err, 'Retry failed'); }
});

export default router;
