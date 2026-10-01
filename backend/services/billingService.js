import pool from '../config/db.js';
import { razorpayClient } from '../utils/razorpay.js';
import { raiseException, autoResolve, audit } from './opsService.js';
import {
  withGst, splitGst, financialYear, formatInvoiceNumber, prorationPaise, classifyChange,
  downgradeBlockers, SUBSCRIPTION_STATUS_FOR_EVENT, DEFAULT_GRACE_DAYS, SAC_CODE,
} from './billingMath.js';

// ---------------------------------------------------------------------------
// Plan billing for schools (Waynur's own revenue — NOT student fees).
//
// Golden rule: nothing the browser does changes schools.plan. Checkout only
// creates a Razorpay subscription/order + a `subscriptions` row in status
// 'created'. The plan changes ONLY inside processBillingEvent(), driven by a
// signature-verified, de-duplicated Razorpay webhook.
// ---------------------------------------------------------------------------

const GRACE_DAYS = Number(process.env.BILLING_GRACE_DAYS || DEFAULT_GRACE_DAYS);
const SUPPLIER_STATE = process.env.WAYNUR_STATE_CODE || '03'; // Punjab
const INVOICE_PREFIX = process.env.INVOICE_PREFIX || 'WN';
const MIN_ADDON_PAISE = 100; // Razorpay minimum chargeable amount (₹1)

export function httpError(statusCode, message, extra = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.status = statusCode; // routes/admissions.js maps err.status
  Object.assign(err, extra);
  return err;
}

// ---------- Catalog & usage ----------

export async function getPlans(client = pool) {
  const { rows } = await client.query(`SELECT * FROM plans WHERE active ORDER BY rank`);
  const out = {};
  for (const p of rows) {
    out[p.code] = {
      ...p,
      price_paise: Number(p.price_paise),
      yearly_price_paise: p.yearly_price_paise ? Number(p.yearly_price_paise) : null,
      // DB value wins; env var kept as fallback so PR #52's existing
      // RAZORPAY_PLAN_ID_* config keeps working without a data migration.
      razorpay_plan_id: p.razorpay_plan_id || process.env[`RAZORPAY_PLAN_ID_${p.code.toUpperCase()}`] || null,
    };
  }
  return out;
}

export async function getUsage(schoolId, client = pool) {
  const { rows } = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM students WHERE school_id = $1 AND is_demo = FALSE)::int AS students,
       (SELECT COUNT(*) FROM teachers WHERE school_id = $1 AND is_demo = FALSE)::int AS staff,
       (SELECT COUNT(*) FROM teachers WHERE school_id = $1 AND role = 'accountant' AND is_demo = FALSE)::int AS accountants`,
    [schoolId]
  );
  return rows[0];
}

// Backend enforcement of plan limits (previously only shown in the UI).
// Only the student limit is a plan limit; accountant logins are unlimited on
// every plan (addAccountants is accepted and ignored for older callers).
// Throws 402 with a clear message; callers map err.statusCode to the response.
export async function assertCapacity(schoolId, { addStudents = 0 } = {}, client = pool) {
  if (!addStudents) return;
  const schoolRes = await client.query('SELECT plan FROM schools WHERE id = $1', [schoolId]);
  const plans = await getPlans(client);
  const plan = plans[schoolRes.rows[0]?.plan] || plans.starter;
  if (!plan) return; // catalog missing — fail open rather than block a school's operations
  const usage = await getUsage(schoolId, client);
  if (addStudents && usage.students + addStudents > plan.student_limit) {
    throw httpError(402, `Your ${plan.name} plan allows ${plan.student_limit} students (currently ${usage.students}). Upgrade from Billing to add more.`, { code: 'PLAN_LIMIT_STUDENTS' });
  }
}

// ---------- Checkout ----------

async function currentSubscription(schoolId, client = pool) {
  const { rows } = await client.query(
    `SELECT sub.* FROM schools s JOIN subscriptions sub ON sub.id = s.current_subscription_id
     WHERE s.id = $1 AND sub.status IN ('active', 'pending', 'authenticated') AND sub.current_period_end > NOW()`,
    [schoolId]
  );
  return rows[0] || null;
}

// Computes what the school will pay (and when the change applies) without
// creating anything — powers the checkout modal's price + GST breakdown.
export async function quoteChange({ schoolId, planCode, cycle = 'monthly' }) {
  if (!['monthly', 'yearly'].includes(cycle)) throw httpError(400, 'cycle must be monthly or yearly');
  const plans = await getPlans();
  const target = plans[planCode];
  if (!target) throw httpError(400, 'Unknown plan');

  const schoolRes = await pool.query('SELECT plan, billing_status FROM schools WHERE id = $1', [schoolId]);
  if (!schoolRes.rowCount) throw httpError(404, 'School not found');
  const current = await currentSubscription(schoolId);
  const currentPlan = current ? plans[current.plan_code] : null;
  const kind = current ? classifyChange(currentPlan, target) : 'new';
  if (kind === 'same' && current.billing_cycle === cycle) throw httpError(400, `You're already on the ${target.name} plan`);

  if (kind === 'downgrade') {
    const blockers = downgradeBlockers(await getUsage(schoolId), target);
    if (blockers.length) {
      throw httpError(409, `Can't move to ${target.name} yet: ${blockers.join('; ')}. Reduce usage first.`, { code: 'DOWNGRADE_BLOCKED', blockers });
    }
  }

  if (cycle === 'monthly' && !target.razorpay_plan_id) {
    throw httpError(400, `Online payment for ${target.name} monthly isn't set up yet — choose yearly or contact support.`);
  }
  if (cycle === 'yearly' && !target.yearly_price_paise) throw httpError(400, `Yearly billing isn't available for ${target.name}`);

  const listPaise = cycle === 'yearly' ? target.yearly_price_paise : target.price_paise;
  let prorationExGst = 0;
  if (kind === 'upgrade') {
    const yearly = current.billing_cycle === 'yearly';
    prorationExGst = prorationPaise({
      oldPricePaise: yearly ? currentPlan.yearly_price_paise : currentPlan.price_paise,
      newPricePaise: yearly ? target.yearly_price_paise : target.price_paise,
      periodStart: current.current_period_start,
      periodEnd: current.current_period_end,
    });
    if (prorationExGst < MIN_ADDON_PAISE) prorationExGst = 0;
  }

  // New term starts when the paid one ends, so nobody pays twice for the
  // same days. Upgrades get access immediately (that's what proration buys).
  const startsAt = current ? new Date(current.current_period_end) : new Date();
  const recurringWithGst = withGst(listPaise);
  const prorationWithGst = withGst(prorationExGst);
  const dueNowPaise = cycle === 'yearly' ? recurringWithGst + prorationWithGst : prorationWithGst + (current ? 0 : recurringWithGst);

  return {
    kind,
    cycle,
    plan: { code: target.code, name: target.name },
    from_plan: currentPlan ? { code: currentPlan.code, name: currentPlan.name } : null,
    list_price_paise: listPaise,
    gst_paise: recurringWithGst - listPaise,
    recurring_total_paise: recurringWithGst,
    proration_ex_gst_paise: prorationExGst,
    proration_total_paise: prorationWithGst,
    due_now_paise: dueNowPaise,
    applies: kind === 'downgrade' ? 'next_cycle' : 'now',
    new_term_starts_at: startsAt.toISOString(),
    // RBI e-mandate rule: recurring debits above ₹15,000 need the payer's
    // OTP every time (card/UPI). Surface it so District schools pick yearly.
    afa_each_debit: cycle === 'monthly' && recurringWithGst > 1500000,
    _internal: { target, current, currentPlan, startsAt },
  };
}

export async function startCheckout({ schoolId, teacherId, planCode, cycle = 'monthly' }) {
  const q = await quoteChange({ schoolId, planCode, cycle });
  const { target, current, startsAt } = q._internal;
  const schoolRes = await pool.query(
    `SELECT s.name, t.name AS principal_name, t.email, t.phone FROM schools s
     LEFT JOIN teachers t ON t.id = $2 WHERE s.id = $1`,
    [schoolId, teacherId]
  );
  const school = schoolRes.rows[0];
  const notes = { school_id: String(schoolId), plan: target.code, kind: q.kind, cycle, app: 'waynur_plan' };
  const rz = razorpayClient();

  // Abandoned checkouts from earlier attempts stay as history, not "live".
  await pool.query(`UPDATE subscriptions SET status = 'expired', updated_at = NOW() WHERE school_id = $1 AND status = 'created'`, [schoolId]);

  let rzSubId = null;
  let rzOrderId = null;
  if (cycle === 'monthly') {
    const body = {
      plan_id: target.razorpay_plan_id,
      total_count: 120, // Razorpay requires a finite count; 10 years of monthly cycles
      customer_notify: 0,
      notes,
    };
    if (current) body.start_at = Math.floor(startsAt.getTime() / 1000);
    if (q.proration_total_paise >= MIN_ADDON_PAISE) {
      body.addons = [{ item: { name: `Prorated upgrade to ${target.name}`, amount: q.proration_total_paise, currency: 'INR' } }];
    }
    rzSubId = (await rz.post('/subscriptions', body)).data.id;
  } else {
    const receipt = `wn-${schoolId}-${Date.now()}`;
    rzOrderId = (await rz.post('/orders', { amount: q.due_now_paise, currency: 'INR', receipt, notes })).data.id;
  }

  // replaces = the live sub, or (when nothing is live) a lapsed/halted one
  // that should be closed out once this new one activates.
  const prevRes = await pool.query(`SELECT current_subscription_id FROM schools WHERE id = $1`, [schoolId]);
  const replaces = current?.id || prevRes.rows[0]?.current_subscription_id || null;
  const ins = await pool.query(
    `INSERT INTO subscriptions (school_id, plan_code, billing_cycle, kind, razorpay_subscription_id, razorpay_order_id, status, replaces_subscription_id, created_by, current_period_start)
     VALUES ($1, $2, $3, $4, $5, $6, 'created', $7, $8, $9) RETURNING id`,
    [schoolId, target.code, cycle, q.kind, rzSubId, rzOrderId, replaces, teacherId || null, startsAt]
  );
  // A school with no live plan shows "awaiting payment"; an active school
  // stays 'active' while it's merely shopping for an upgrade.
  if (!current) {
    await pool.query(`UPDATE schools SET billing_status = 'pending_activation' WHERE id = $1 AND billing_status <> 'active'`, [schoolId]);
  }
  await audit({ schoolId, actorType: 'user', actorId: teacherId, action: 'billing.checkout_started', entityType: 'subscription', entityId: ins.rows[0].id, detail: { plan: target.code, cycle, kind: q.kind } });

  const { _internal, ...quote } = q;
  return {
    subscription_row_id: ins.rows[0].id,
    quote,
    checkout: {
      key: process.env.RAZORPAY_KEY_ID,
      subscription_id: rzSubId || undefined,
      order_id: rzOrderId || undefined,
      amount: rzOrderId ? q.due_now_paise : undefined,
      currency: 'INR',
      name: 'Waynur',
      description: `${target.name} plan · ${cycle}`,
      prefill: { name: school?.principal_name || '', email: school?.email || '', contact: school?.phone || '' },
      notes,
    },
  };
}

export async function cancelAtPeriodEnd({ schoolId, teacherId }) {
  const current = await currentSubscription(schoolId);
  if (!current) throw httpError(400, 'No active subscription to cancel');
  if (current.razorpay_subscription_id) {
    await razorpayClient().post(`/subscriptions/${current.razorpay_subscription_id}/cancel`, { cancel_at_cycle_end: 1 });
  }
  await pool.query(`UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = NOW() WHERE id = $1`, [current.id]);
  await audit({ schoolId, actorType: 'user', actorId: teacherId, action: 'billing.cancel_requested', entityType: 'subscription', entityId: current.id });
  return { cancels_at: current.current_period_end };
}

// ---------- Webhook ingestion (fast path: store + ack) ----------

// Returns { id, duplicate }. Called from the webhook route AFTER signature
// verification. The UNIQUE event id is what makes retries harmless.
export async function recordBillingEvent(eventId, body) {
  const ins = await pool.query(
    `INSERT INTO billing_events (razorpay_event_id, event, payload) VALUES ($1, $2, $3)
     ON CONFLICT (razorpay_event_id) DO NOTHING RETURNING id`,
    [eventId, body.event, body]
  );
  if (ins.rowCount) return { id: ins.rows[0].id, duplicate: false };
  const existing = await pool.query(`SELECT id, status FROM billing_events WHERE razorpay_event_id = $1`, [eventId]);
  return { id: existing.rows[0]?.id, duplicate: existing.rows[0]?.status === 'processed' || existing.rows[0]?.status === 'ignored' };
}

export function isPlanBillingEvent(body) {
  const ev = body?.event || '';
  if (ev.startsWith('subscription.')) return true;
  if (ev === 'invoice.paid') return !!body.payload?.invoice?.entity?.subscription_id;
  if (ev === 'order.paid' || ev === 'payment.captured') {
    const notes = body.payload?.order?.entity?.notes || body.payload?.payment?.entity?.notes || {};
    return notes.app === 'waynur_plan';
  }
  return false;
}

// ---------- Webhook processing (slow path: BullMQ worker / sweeper) ----------

export async function processBillingEvent(billingEventId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const evRes = await client.query(
      `SELECT * FROM billing_events WHERE id = $1 AND status IN ('received', 'failed') FOR UPDATE SKIP LOCKED`,
      [billingEventId]
    );
    if (!evRes.rowCount) { await client.query('ROLLBACK'); return 'skipped'; }
    const ev = evRes.rows[0];
    let outcome;
    try {
      outcome = await applyEvent(client, ev.event, ev.payload.payload || {});
      await client.query(
        `UPDATE billing_events SET status = $2, attempts = attempts + 1, processed_at = NOW(), error = NULL WHERE id = $1`,
        [ev.id, outcome === 'ignored' ? 'ignored' : 'processed']
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      await pool.query(`UPDATE billing_events SET status = 'failed', attempts = attempts + 1, error = $2 WHERE id = $1`, [ev.id, String(err.stack || err.message).slice(0, 4000)]);
      throw err;
    }
    // Side effects that must never roll back a committed state change.
    if (outcome?.after) await outcome.after().catch((e) => console.error('[billing] post-commit step failed:', e.message));
    return outcome?.result || outcome;
  } finally {
    client.release();
  }
}

async function findOrAdoptSubscription(client, rzSub) {
  const found = await client.query(`SELECT * FROM subscriptions WHERE razorpay_subscription_id = $1 FOR UPDATE`, [rzSub.id]);
  if (found.rowCount) return found.rows[0];
  // Subscriptions created by the old POST /subscribe (PR #52) have no row
  // here yet — adopt them from the notes Razorpay echoes back.
  const schoolId = Number(rzSub.notes?.school_id);
  const plan = rzSub.notes?.plan;
  if (!schoolId || !plan) return null;
  const ins = await client.query(
    `INSERT INTO subscriptions (school_id, plan_code, billing_cycle, kind, razorpay_subscription_id, status)
     VALUES ($1, $2, 'monthly', 'new', $3, 'created') RETURNING *`,
    [schoolId, plan, rzSub.id]
  );
  return ins.rows[0];
}

async function makeCurrent(client, sub) {
  await client.query(
    `UPDATE schools SET plan = $2::varchar, billing_status = 'active', current_subscription_id = $3::int,
       current_period_end = $4::timestamptz, plan_renews_at = ($4::timestamptz AT TIME ZONE 'Asia/Kolkata')::date,
       razorpay_subscription_id = COALESCE($5::varchar, razorpay_subscription_id),
       billing_grace_until = NULL,
       pending_plan_code = CASE WHEN pending_plan_code = $2::varchar THEN NULL ELSE pending_plan_code END
     WHERE id = $1`,
    [sub.school_id, sub.plan_code, sub.id, sub.current_period_end, sub.razorpay_subscription_id]
  );
  await syncLimitColumns(client, sub.school_id, sub.plan_code);
}

// schools.student_limit / accountant_seat_limit pre-date the plans table;
// keep them in sync for any older reader.
async function syncLimitColumns(client, schoolId, planCode) {
  await client.query(
    `UPDATE schools s SET student_limit = p.student_limit, accountant_seat_limit = p.accountant_seats
     FROM plans p WHERE s.id = $1 AND p.code = $2`,
    [schoolId, planCode]
  );
}

// Upgrade: plan flips the moment the prorated amount is paid.
async function applyUpgradeNow(client, sub) {
  await client.query(`UPDATE schools SET plan = $2, billing_status = 'active', billing_grace_until = NULL WHERE id = $1`, [sub.school_id, sub.plan_code]);
  await syncLimitColumns(client, sub.school_id, sub.plan_code);
}

async function cancelReplaced(client, sub) {
  if (!sub.replaces_subscription_id) return null;
  const old = await client.query(`SELECT * FROM subscriptions WHERE id = $1`, [sub.replaces_subscription_id]);
  const o = old.rows[0];
  if (!o || o.cancel_at_period_end || !['active', 'pending', 'authenticated', 'halted'].includes(o.status)) return null;
  await client.query(`UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = NOW() WHERE id = $1`, [o.id]);
  if (!o.razorpay_subscription_id) return null;
  // A halted/lapsed sub is cancelled outright so Razorpay stops retrying it;
  // a healthy one runs to the end of the period the school already paid for.
  const immediate = o.status === 'halted' || (o.current_period_end && new Date(o.current_period_end) <= new Date());
  return async () => {
    await razorpayClient().post(`/subscriptions/${o.razorpay_subscription_id}/cancel`, { cancel_at_cycle_end: immediate ? 0 : 1 });
  };
}

function ts(unix) {
  return unix ? new Date(unix * 1000) : null;
}

async function applyEvent(client, event, payload) {
  // ---- Recurring subscriptions ----
  if (event.startsWith('subscription.')) {
    const rzSub = payload.subscription?.entity;
    if (!rzSub?.id) return 'ignored';
    const sub = await findOrAdoptSubscription(client, rzSub);
    if (!sub) return 'ignored';
    const newStatus = SUBSCRIPTION_STATUS_FOR_EVENT[event];
    if (!newStatus) return 'ignored';

    const upd = await client.query(
      `UPDATE subscriptions SET status = $2::varchar,
         current_period_start = COALESCE($3::timestamptz, current_period_start),
         current_period_end = COALESCE($4::timestamptz, current_period_end),
         halted_at = CASE WHEN $2::varchar = 'halted' THEN COALESCE(halted_at, NOW()) ELSE NULL END,
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [sub.id, newStatus, ts(rzSub.current_start), ts(rzSub.current_end)]
    );
    const s = upd.rows[0];
    const schoolRes = await client.query(`SELECT current_subscription_id, plan FROM schools WHERE id = $1 FOR UPDATE`, [s.school_id]);
    const isCurrent = schoolRes.rows[0]?.current_subscription_id === s.id;
    const after = [];

    if (event === 'subscription.authenticated') {
      if (s.kind === 'upgrade') {
        await applyUpgradeNow(client, s);
        const c = await cancelReplaced(client, s); if (c) after.push(c);
      } else if (s.kind === 'downgrade') {
        await client.query(`UPDATE schools SET pending_plan_code = $2 WHERE id = $1`, [s.school_id, s.plan_code]);
        const c = await cancelReplaced(client, s); if (c) after.push(c);
      }
    } else if (newStatus === 'active') {
      // An old sub that's been superseded (upgrade/downgrade) can still emit
      // a late charged/activated event — it must never take the school back.
      if (s.cancel_at_period_end) {
        if (event === 'subscription.charged' && payload.payment?.entity) await createInvoice(client, { sub: s, payment: payload.payment.entity });
        return { result: 'superseded' };
      }
      await makeCurrent(client, s);
      if (s.kind === 'new') { const c = await cancelReplaced(client, s); if (c) after.push(c); }
      after.push(() => autoResolve(`billing:${s.school_id}:payment`, { schoolId: s.school_id, note: 'Payment received' }));
      if (event === 'subscription.charged' && payload.payment?.entity) {
        await createInvoice(client, { sub: s, payment: payload.payment.entity });
      }
    } else if (newStatus === 'pending' && isCurrent) {
      await client.query(`UPDATE schools SET billing_status = 'payment_pending' WHERE id = $1`, [s.school_id]);
      after.push(() => raiseException({
        schoolId: s.school_id, source: 'billing', severity: 'high',
        title: 'Waynur subscription payment failed — Razorpay is retrying',
        body: 'The last auto-debit for your Waynur plan did not go through. Update the payment method from Billing to avoid interruption.',
        suggestedAction: 'Open Billing and retry payment', dedupeKey: `billing:${s.school_id}:payment`,
      }));
    } else if (newStatus === 'halted' && isCurrent) {
      await client.query(
        `UPDATE schools SET billing_status = 'halted',
           billing_grace_until = COALESCE(billing_grace_until, NOW() + ($2::text || ' days')::interval)
         WHERE id = $1`,
        [s.school_id, String(GRACE_DAYS)]
      );
      after.push(() => raiseException({
        schoolId: s.school_id, source: 'billing', severity: 'critical',
        title: `Waynur subscription halted — account becomes read-only in ${GRACE_DAYS} days`,
        body: 'All retries for your plan payment failed. Pay from Billing to keep adding and editing data. Your data stays readable.',
        suggestedAction: 'Open Billing and pay now', dedupeKey: `billing:${s.school_id}:payment`,
      }));
    } else if ((newStatus === 'cancelled' || newStatus === 'completed') && isCurrent) {
      // Replaced by an upgrade/downgrade? Then the replacement owns the school
      // state and this cancellation is just the old one winding down.
      const replacement = await client.query(
        `SELECT 1 FROM subscriptions WHERE replaces_subscription_id = $1 AND status IN ('authenticated', 'active')`,
        [s.id]
      );
      if (!replacement.rowCount) {
        await client.query(`UPDATE schools SET billing_status = 'cancelled' WHERE id = $1`, [s.school_id]);
      }
    }
    return { result: newStatus, after: after.length ? async () => { for (const f of after) await f(); } : null };
  }

  // ---- Subscription invoices (recurring charges + upfront upgrade addon) ----
  if (event === 'invoice.paid') {
    const inv = payload.invoice?.entity;
    const payment = payload.payment?.entity || (inv?.payment_id ? { id: inv.payment_id, amount: inv.amount_paid } : null);
    if (!inv?.subscription_id || !payment?.id) return 'ignored';
    const sub = await client.query(`SELECT * FROM subscriptions WHERE razorpay_subscription_id = $1`, [inv.subscription_id]);
    if (!sub.rowCount) return 'ignored';
    await createInvoice(client, { sub: sub.rows[0], payment });
    return 'invoiced';
  }

  // ---- Yearly / one-time plan orders ----
  if (event === 'order.paid' || event === 'payment.captured') {
    const order = payload.order?.entity;
    const payment = payload.payment?.entity;
    const orderId = order?.id || payment?.order_id;
    if (!orderId || !payment?.id) return 'ignored';
    const subRes = await client.query(`SELECT * FROM subscriptions WHERE razorpay_order_id = $1 FOR UPDATE`, [orderId]);
    if (!subRes.rowCount) return 'ignored';
    let s = subRes.rows[0];
    if (s.status === 'created') {
      const start = s.current_period_start && new Date(s.current_period_start) > new Date() ? new Date(s.current_period_start) : new Date();
      const end = new Date(start); end.setFullYear(end.getFullYear() + 1);
      s = (await client.query(
        `UPDATE subscriptions SET status = 'active', current_period_start = $2, current_period_end = $3, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [s.id, start, end]
      )).rows[0];
      const after = [];
      if (s.kind === 'downgrade') {
        await client.query(`UPDATE schools SET pending_plan_code = $2 WHERE id = $1`, [s.school_id, s.plan_code]);
      } else if (s.kind === 'upgrade') {
        await applyUpgradeNow(client, s);
      } else {
        await makeCurrent(client, s);
      }
      const c = await cancelReplaced(client, s); if (c) after.push(c);
      await createInvoice(client, { sub: s, payment });
      return { result: 'order_activated', after: after.length ? async () => { for (const f of after) await f(); } : null };
    }
    await createInvoice(client, { sub: s, payment }); // idempotent on payment id
    return 'invoiced';
  }

  return 'ignored';
}

// ---------- GST invoices ----------

async function createInvoice(client, { sub, payment }) {
  const exists = await client.query(`SELECT id FROM invoices WHERE razorpay_payment_id = $1`, [payment.id]);
  if (exists.rowCount) return exists.rows[0].id;
  const total = Number(payment.amount);
  if (!total || total < MIN_ADDON_PAISE) return null; // ₹0/₹1 mandate-auth transactions aren't sales

  const school = (await client.query(
    `SELECT name, billing_legal_name, billing_gstin, billing_address, address, billing_state_code FROM schools WHERE id = $1`,
    [sub.school_id]
  )).rows[0];
  const plan = (await client.query(`SELECT name FROM plans WHERE code = $1`, [sub.plan_code])).rows[0];
  const fy = financialYear(payment.created_at ? new Date(payment.created_at * 1000) : new Date());
  // Gap-free sequence: the counter row is locked until this transaction commits.
  const seqRes = await client.query(
    `INSERT INTO invoice_counters (fy, last_seq) VALUES ($1, 1)
     ON CONFLICT (fy) DO UPDATE SET last_seq = invoice_counters.last_seq + 1 RETURNING last_seq`,
    [fy]
  );
  const seq = seqRes.rows[0].last_seq;
  const tax = splitGst(total, SUPPLIER_STATE, school.billing_state_code);
  const desc = `Waynur ${plan?.name || sub.plan_code} plan — ${sub.billing_cycle} subscription${sub.kind === 'upgrade' ? ' (incl. prorated upgrade)' : ''}`;
  const ins = await client.query(
    `INSERT INTO invoices (school_id, subscription_id, invoice_number, fy, seq, razorpay_payment_id, plan_code, description, sac_code,
       taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, place_of_supply, buyer_name, buyer_gstin, buyer_address, period_start, period_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
    [sub.school_id, sub.id, formatInvoiceNumber(INVOICE_PREFIX, fy, seq), fy, seq, payment.id, sub.plan_code, desc, SAC_CODE,
      tax.taxable, tax.cgst, tax.sgst, tax.igst, tax.total, school.billing_state_code || null,
      school.billing_legal_name || school.name, school.billing_gstin || null, school.billing_address || school.address || null,
      sub.current_period_start, sub.current_period_end]
  );
  return ins.rows[0].id;
}

// ---------- Periodic sweep (in-process timer, works even if Redis is down) ----------

export async function sweepBilling() {
  // 1) Webhook events that never got processed (Redis down, crash, etc.).
  const stuck = await pool.query(
    `SELECT id FROM billing_events
     WHERE (status = 'received' AND received_at < NOW() - INTERVAL '2 minutes')
        OR (status = 'failed' AND attempts < 8)
     ORDER BY id LIMIT 50`
  );
  for (const r of stuck.rows) {
    await processBillingEvent(r.id).catch((e) => console.error(`[billing] event ${r.id} failed:`, e.message));
  }

  // 2) Yearly terms that have started (booked downgrade / renewal) → current.
  const starting = await pool.query(
    `SELECT sub.* FROM subscriptions sub JOIN schools s ON s.id = sub.school_id
     WHERE sub.billing_cycle = 'yearly' AND sub.status = 'active' AND sub.current_period_start <= NOW()
       AND sub.current_period_end > NOW() AND s.current_subscription_id IS DISTINCT FROM sub.id`
  );
  for (const sub of starting.rows) {
    const c = await pool.connect();
    try { await c.query('BEGIN'); await makeCurrent(c, sub); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK'); console.error('[billing] yearly rollover failed:', e.message); }
    finally { c.release(); }
  }

  // 3) Yearly terms that ended with nothing after them → cancelled (read-only
  //    via isReadOnly once current_period_end has passed).
  await pool.query(
    `UPDATE schools s SET billing_status = 'cancelled'
     FROM subscriptions sub
     WHERE sub.id = s.current_subscription_id AND sub.billing_cycle = 'yearly'
       AND sub.current_period_end <= NOW() AND s.billing_status = 'active'`
  );

  // 4) Renewal reminders for yearly plans: 15 and 3 days before expiry.
  const expiring = await pool.query(
    `SELECT s.id, sub.current_period_end FROM schools s JOIN subscriptions sub ON sub.id = s.current_subscription_id
     WHERE sub.billing_cycle = 'yearly' AND sub.current_period_end BETWEEN NOW() AND NOW() + INTERVAL '15 days'
       AND NOT EXISTS (SELECT 1 FROM subscriptions n WHERE n.replaces_subscription_id = sub.id AND n.status IN ('active','authenticated'))`
  );
  for (const r of expiring.rows) {
    const days = Math.ceil((new Date(r.current_period_end) - Date.now()) / 86400000);
    const bucket = days <= 3 ? '3d' : '15d';
    await raiseException({
      schoolId: r.id, source: 'billing', severity: days <= 3 ? 'high' : 'medium',
      title: `Waynur yearly plan renews in ${days} day(s)`,
      body: 'Renew from Billing to avoid your account switching to read-only.',
      suggestedAction: 'Open Billing and renew', dedupeKey: `billing:${r.id}:renewal:${bucket}`,
    });
  }
}
