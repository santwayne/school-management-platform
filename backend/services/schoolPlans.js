// Core (₹400) / AI (₹650) per-student plans: everything the Super Admin does
// to a school's plan — demo, recording a payment, upgrade, downgrade — plus
// the daily sweep that expires demos/paid periods and applies booked
// downgrades. Billing is manual: money is collected outside Waynur (bank,
// UPI, cheque, a Razorpay link) and recorded here.
import pool from '../config/db.js';
import { raiseException, audit } from './opsService.js';
import {
  NEW_PLANS, DAY_MS, yearlyPricePaise, gstPaise, prorateUpgradePaise,
  effectiveState, hasAi, defaultPeriodEnd, isDate, graceDays,
} from './planMath.js';

export class PlanError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const METHODS = ['bank', 'upi', 'cheque', 'cash', 'razorpay_link', 'comp'];
const MAX_DEMO_DAYS = 90;
const rupees = (paise) => (paise == null ? null : Number(paise) / 100);
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Catalog ----------

export async function getNewPlans(client = pool) {
  const { rows } = await client.query(
    `SELECT code, name, per_student_yearly_paise, min_yearly_paise, includes_ai, updated_at
       FROM plans WHERE code = ANY($1) ORDER BY rank`, [NEW_PLANS]);
  const out = {};
  for (const r of rows) {
    out[r.code] = { ...r, per_student_yearly_paise: Number(r.per_student_yearly_paise), min_yearly_paise: Number(r.min_yearly_paise) };
  }
  return out;
}

export function planForClient(p) {
  return {
    code: p.code,
    name: p.name,
    per_student_yearly: rupees(p.per_student_yearly_paise),
    per_student_monthly: Math.round(Number(p.per_student_yearly_paise) / 12) / 100,
    min_yearly: rupees(p.min_yearly_paise),
    includes_ai: p.includes_ai,
    updated_at: p.updated_at,
  };
}

// Super Admin edits the per-student rate / yearly minimum. Existing paid
// periods are not touched — new rates apply to the next payment recorded.
export async function updatePlanRates({ code, perStudentYearly, minYearly, actorId, reason }) {
  if (!NEW_PLANS.includes(code)) throw new PlanError('Only the Core and AI plans can be edited here');
  const per = Math.round(Number(perStudentYearly) * 100);
  const min = Math.round(Number(minYearly) * 100);
  if (!Number.isFinite(per) || per < 100 || per > 10_000_00) throw new PlanError('Per-student yearly price must be between ₹1 and ₹10,000');
  if (!Number.isFinite(min) || min < 0 || min > 1_00_00_000_00) throw new PlanError('Yearly minimum must be between ₹0 and ₹1 crore');
  const before = (await getNewPlans())[code];
  const { rows } = await pool.query(
    `UPDATE plans SET per_student_yearly_paise = $2, min_yearly_paise = $3, updated_at = NOW() WHERE code = $1 RETURNING *`,
    [code, per, min]);
  await pool.query(
    `INSERT INTO plan_audit (plan_code, actor_id, action, detail) VALUES ($1, $2, 'rates_updated', $3)`,
    [code, actorId || null, JSON.stringify({
      from: { per_student_yearly: rupees(before?.per_student_yearly_paise), min_yearly: rupees(before?.min_yearly_paise) },
      to: { per_student_yearly: per / 100, min_yearly: min / 100 },
      reason: reason || null,
    })]);
  return planForClient({ ...rows[0], per_student_yearly_paise: Number(rows[0].per_student_yearly_paise), min_yearly_paise: Number(rows[0].min_yearly_paise) });
}

// ---------- Reading a school's plan ----------

async function loadSchool(schoolId, client = pool, lock = false) {
  const { rows } = await client.query(
    `SELECT s.id, s.name, s.plan, s.plan_state, s.demo_started_at, s.demo_ends_at, to_char(s.paid_until, 'YYYY-MM-DD') AS paid_until,
            s.licensed_students, s.pending_plan_code, s.status,
            (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.is_demo = FALSE)::int AS student_count
       FROM schools s WHERE s.id = $1 ${lock ? 'FOR UPDATE OF s' : ''}`, [schoolId]);
  if (!rows[0]) throw new PlanError('School not found', 404);
  return rows[0];
}

export function describeSchoolPlan(school, plans, now = new Date()) {
  const state = effectiveState(school, now);
  const plan = plans[school.plan];
  const students = Number(school.student_count || 0);
  const billable = Math.max(students, Number(school.licensed_students || 0));
  const daysLeft = (d) => (d ? Math.ceil((new Date(d) - now) / DAY_MS) : null);
  return {
    school_id: school.id,
    school_name: school.name,
    school_status: school.status,
    plan: school.plan,
    plan_name: plan?.name || `${school.plan} (retired plan)`,
    is_retired_plan: !NEW_PLANS.includes(school.plan),
    state,
    ai_enabled: hasAi(school, now),
    demo_started_at: school.demo_started_at,
    demo_ends_at: school.demo_ends_at,
    demo_days_left: state === 'demo' ? daysLeft(school.demo_ends_at) : null,
    paid_until: school.paid_until,
    paid_days_left: ['paid', 'grace'].includes(state) ? daysLeft(school.paid_until) : null,
    grace_days: graceDays(),
    pending_plan_code: school.pending_plan_code,
    students,
    licensed_students: school.licensed_students,
    over_licence: school.licensed_students != null && students > school.licensed_students,
    yearly_value: plan ? rupees(yearlyPricePaise(plan, billable)) : null,
  };
}

export async function getSchoolPlan(schoolId) {
  const [school, plans] = await Promise.all([loadSchool(schoolId), getNewPlans()]);
  const events = await pool.query(
    `SELECT e.*, to_char(e.period_start, 'YYYY-MM-DD') AS period_start, to_char(e.period_end, 'YYYY-MM-DD') AS period_end,
            sa.email AS actor_email FROM school_plan_events e
       LEFT JOIN super_admins sa ON sa.id = e.actor_id
      WHERE e.school_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 50`, [schoolId]);
  return {
    ...describeSchoolPlan(school, plans),
    history: events.rows.map((e) => ({ ...e, amount: rupees(e.amount_paise), gst: rupees(e.gst_paise) })),
  };
}

export async function schoolHasAi(schoolId) {
  if (!schoolId) return false;
  const { rows } = await pool.query(
    'SELECT plan, plan_state, demo_ends_at, paid_until FROM schools WHERE id = $1', [schoolId]);
  return hasAi(rows[0]);
}

// SQL condition (alias "s" = schools) for background AI automations: only
// schools whose plan includes AI and is not expired. Mirrors hasAi(); the
// date checks cover the gap before the sweep updates plan_state.
export const AI_SCHOOLS_SQL = `(
  (s.plan NOT IN ('core', 'ai') AND COALESCE(s.plan_state, 'legacy') IN ('legacy', 'none'))
  OR (s.plan = 'ai' AND s.plan_state = 'legacy')
  OR (s.plan = 'ai' AND s.plan_state = 'demo' AND s.demo_ends_at > NOW())
  OR (s.plan = 'ai' AND s.plan_state = 'paid' AND (s.paid_until IS NULL OR s.paid_until + make_interval(days => ${Math.floor(graceDays())}) >= CURRENT_DATE))
  OR (s.plan = 'ai' AND s.plan_state = 'none')
)`;

// ---------- Overview for the Super Admin ----------

export async function planOverview() {
  const plans = await getNewPlans();
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.plan, s.plan_state, s.demo_started_at, s.demo_ends_at, to_char(s.paid_until, 'YYYY-MM-DD') AS paid_until,
            s.licensed_students, s.pending_plan_code, s.status, s.created_at,
            (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.is_demo = FALSE)::int AS student_count
       FROM schools s ORDER BY s.name`);
  const now = new Date();
  const schools = rows.map((r) => describeSchoolPlan(r, plans, now));
  const count = (fn) => schools.filter(fn).length;
  const live = (s) => ['paid', 'grace'].includes(s.state);
  return {
    plans: Object.values(plans).map(planForClient),
    summary: {
      total: schools.length,
      core_paid: count((s) => s.plan === 'core' && live(s)),
      ai_paid: count((s) => s.plan === 'ai' && live(s)),
      demo_active: count((s) => s.state === 'demo'),
      demo_ending_7d: count((s) => s.state === 'demo' && s.demo_days_left <= 7),
      renewals_due_30d: count((s) => s.state === 'paid' && s.paid_days_left != null && s.paid_days_left <= 30),
      in_grace: count((s) => s.state === 'grace'),
      expired: count((s) => ['expired', 'demo_expired'].includes(s.state)),
      plan_not_set: count((s) => s.state === 'none'),
      on_retired_plan: count((s) => s.state === 'legacy'),
      downgrades_booked: count((s) => !!s.pending_plan_code),
      over_licence: count((s) => s.over_licence),
      students_core: schools.filter((s) => s.plan === 'core' && live(s)).reduce((a, s) => a + s.students, 0),
      students_ai: schools.filter((s) => s.plan === 'ai' && live(s)).reduce((a, s) => a + s.students, 0),
      yearly_value_paid: schools.filter(live).reduce((a, s) => a + (s.yearly_value || 0), 0),
    },
    schools,
  };
}

// ---------- Quotes ----------

export async function quote({ schoolId, planCode, students }) {
  const plans = await getNewPlans();
  const plan = plans[planCode];
  if (!plan) throw new PlanError('Plan must be core or ai');
  const school = schoolId ? await loadSchool(schoolId) : null;
  const n = students != null && students !== '' ? Math.floor(Number(students)) : (school?.student_count || 0);
  if (!Number.isFinite(n) || n < 0) throw new PlanError('Students must be a whole number');
  const yearly = yearlyPricePaise(plan, n);
  const out = {
    plan: planForClient(plan),
    students: n,
    yearly_price: rupees(yearly),
    gst: rupees(gstPaise(yearly)),
    total_with_gst: rupees(yearly + gstPaise(yearly)),
    minimum_applied: yearly === plan.min_yearly_paise && n * plan.per_student_yearly_paise < plan.min_yearly_paise,
  };
  // Mid-year Core → AI: price only the difference for the days left.
  if (school && school.plan === 'core' && planCode === 'ai' && effectiveState(school) === 'paid' && school.paid_until) {
    const diff = prorateUpgradePaise({ fromPlan: plans.core, toPlan: plan, students: n, paidUntil: school.paid_until });
    out.upgrade = {
      paid_until: school.paid_until,
      amount: rupees(diff),
      gst: rupees(gstPaise(diff)),
      total_with_gst: rupees(diff + gstPaise(diff)),
      note: 'Difference between AI and Core for the days left in the current paid year.',
    };
  }
  return out;
}

// ---------- Actions (each one transactional + logged) ----------

async function withSchool(schoolId, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const school = await loadSchool(schoolId, c, true);
    const out = await fn(c, school);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

async function logEvent(c, e) {
  await c.query(
    `INSERT INTO school_plan_events (school_id, action, from_plan, to_plan, students, amount_paise, gst_paise,
       period_start, period_end, method, reference, note, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [e.schoolId, e.action, e.fromPlan || null, e.toPlan || null, e.students ?? null, e.amountPaise ?? null,
      e.gstPaise ?? null, e.periodStart || null, e.periodEnd || null, e.method || null,
      e.reference ? String(e.reference).slice(0, 120) : null, e.note ? String(e.note).slice(0, 1000) : null, e.actorId || null]);
}

function demoDays(days) {
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n < 1 || n > MAX_DEMO_DAYS) throw new PlanError(`Demo days must be between 1 and ${MAX_DEMO_DAYS}`);
  return n;
}

// Free demo of the AI plan (all features) for N days. After it ends the
// school goes read-only until a payment is recorded.
export async function startDemo({ schoolId, days = 14, actorId, note }) {
  const n = demoDays(days);
  return withSchool(schoolId, async (c, s) => {
    if (effectiveState(s) === 'paid') throw new PlanError('This school has an active paid plan — a demo would replace it. Record a payment or change plan instead.');
    await c.query(
      `UPDATE schools SET plan = 'ai', plan_state = 'demo', demo_started_at = NOW(),
              demo_ends_at = NOW() + make_interval(days => $2), pending_plan_code = NULL
        WHERE id = $1`, [schoolId, n]);
    await logEvent(c, { schoolId, action: 'demo_started', fromPlan: s.plan, toPlan: 'ai', note: note || `${n}-day demo`, actorId });
    return { ok: true, days: n };
  });
}

export async function extendDemo({ schoolId, days, actorId, note }) {
  const n = demoDays(days);
  return withSchool(schoolId, async (c, s) => {
    if (!['demo', 'demo_expired'].includes(effectiveState(s))) throw new PlanError('This school is not on a demo');
    const { rows } = await c.query(
      `UPDATE schools SET plan_state = 'demo',
              demo_ends_at = GREATEST(COALESCE(demo_ends_at, NOW()), NOW()) + make_interval(days => $2)
        WHERE id = $1 RETURNING demo_ends_at`, [schoolId, n]);
    await logEvent(c, { schoolId, action: 'demo_extended', toPlan: s.plan, note: note || `+${n} days`, actorId });
    return { ok: true, demo_ends_at: rows[0].demo_ends_at };
  });
}

// Records a payment the school made outside Waynur and switches the plan on
// for the paid period. Used for: first purchase after demo, yearly renewal,
// adding students mid-year, and the mid-year Core → AI upgrade difference.
export async function recordPayment({ schoolId, planCode, students, amount, periodStart, periodEnd, method, reference, note, actorId }) {
  const plans = await getNewPlans();
  const plan = plans[planCode];
  if (!plan) throw new PlanError('Plan must be core or ai');
  const n = Math.floor(Number(students));
  if (!Number.isFinite(n) || n < 1) throw new PlanError('Students paid for must be at least 1');
  const amountPaise = Math.round(Number(amount) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise < 0) throw new PlanError('Amount must be ₹0 or more (before GST)');
  if (!METHODS.includes(method)) throw new PlanError(`Payment method must be one of: ${METHODS.join(', ')}`);
  if (method !== 'comp' && amountPaise === 0) throw new PlanError('Amount is ₹0 — use method "comp" for a free/complimentary period');
  const start = periodStart || today();
  if (!isDate(start)) throw new PlanError('Period start must be a date (YYYY-MM-DD)');
  const end = periodEnd || defaultPeriodEnd(start);
  if (!isDate(end) || end < start) throw new PlanError('Period end must be a date on or after the start');

  return withSchool(schoolId, async (c, s) => {
    const before = effectiveState(s);
    const action = s.plan === 'core' && planCode === 'ai' && ['paid', 'grace'].includes(before) ? 'upgraded' : 'payment_recorded';
    await c.query(
      `UPDATE schools SET plan = $2, plan_state = 'paid', paid_until = $3::date, licensed_students = $4,
              pending_plan_code = NULL, demo_ends_at = CASE WHEN plan_state = 'demo' THEN LEAST(demo_ends_at, NOW()) ELSE demo_ends_at END
        WHERE id = $1`, [schoolId, planCode, end, n]);
    await logEvent(c, {
      schoolId, action, fromPlan: s.plan, toPlan: planCode, students: n, amountPaise, gstPaise: gstPaise(amountPaise),
      periodStart: start, periodEnd: end, method, reference, note, actorId,
    });
    return { ok: true, plan: planCode, paid_until: end, expected_yearly_price: rupees(yearlyPricePaise(plan, n)) };
  });
}

// Upgrade (Core → AI) applies now. Downgrade (AI → Core) of a paid school is
// booked for the end of the paid year — AI keeps working until then. Outside a
// paid period (demo, expired, plan not set) the change applies now.
export async function changePlan({ schoolId, toPlan, actorId, note }) {
  if (!NEW_PLANS.includes(toPlan)) throw new PlanError('Plan must be core or ai');
  return withSchool(schoolId, async (c, s) => {
    const state = effectiveState(s);
    if (s.plan === toPlan && !s.pending_plan_code) throw new PlanError(`School is already on ${toPlan}`);
    if (s.plan === toPlan && s.pending_plan_code) {
      await c.query('UPDATE schools SET pending_plan_code = NULL WHERE id = $1', [schoolId]);
      await logEvent(c, { schoolId, action: 'downgrade_cancelled', fromPlan: s.plan, toPlan: s.pending_plan_code, note, actorId });
      return { ok: true, applied: 'cancelled_booked_downgrade' };
    }
    const isDowngrade = s.plan === 'ai' && toPlan === 'core';
    if (isDowngrade && state === 'paid') {
      await c.query('UPDATE schools SET pending_plan_code = $2 WHERE id = $1', [schoolId, toPlan]);
      await logEvent(c, { schoolId, action: 'downgrade_scheduled', fromPlan: s.plan, toPlan, periodEnd: s.paid_until, note, actorId });
      return { ok: true, applied: 'at_period_end', effective_on: s.paid_until };
    }
    // Legacy schools moving to the new plans without a payment yet start as 'none'.
    const newState = state === 'legacy' ? 'none' : s.plan_state;
    await c.query('UPDATE schools SET plan = $2, plan_state = $3, pending_plan_code = NULL WHERE id = $1', [schoolId, toPlan, newState]);
    await logEvent(c, { schoolId, action: isDowngrade ? 'downgrade_applied' : (toPlan === 'ai' ? 'upgraded' : 'plan_set'), fromPlan: s.plan, toPlan, note, actorId });
    return { ok: true, applied: 'now' };
  });
}

export async function cancelDowngrade({ schoolId, actorId, note }) {
  return withSchool(schoolId, async (c, s) => {
    if (!s.pending_plan_code) throw new PlanError('No downgrade is booked for this school');
    await c.query('UPDATE schools SET pending_plan_code = NULL WHERE id = $1', [schoolId]);
    await logEvent(c, { schoolId, action: 'downgrade_cancelled', fromPlan: s.plan, toPlan: s.pending_plan_code, note, actorId });
    return { ok: true };
  });
}

// ---------- Daily sweep ----------

export async function sweepPlans() {
  // 1) Booked downgrades whose paid year has ended → switch plan (the school
  //    renews on the new plan; until then normal grace/expiry rules apply).
  const due = await pool.query(
    `SELECT id, plan, pending_plan_code FROM schools
      WHERE pending_plan_code IS NOT NULL AND plan_state = 'paid' AND paid_until < CURRENT_DATE`);
  for (const s of due.rows) {
    await withSchool(s.id, async (c, cur) => {
      if (!cur.pending_plan_code) return;
      await c.query('UPDATE schools SET plan = pending_plan_code, pending_plan_code = NULL WHERE id = $1', [s.id]);
      await logEvent(c, { schoolId: s.id, action: 'downgrade_applied', fromPlan: cur.plan, toPlan: cur.pending_plan_code, note: 'Paid year ended' });
    }).catch((e) => console.error('[plans] downgrade apply failed:', e.message));
  }

  // 2) Demos and paid periods (past grace) that are over → expired (read-only).
  const ending = await pool.query(
    `SELECT id, plan, plan_state FROM schools
      WHERE (plan_state = 'demo' AND demo_ends_at <= NOW())
         OR (plan_state = 'paid' AND paid_until IS NOT NULL
             AND paid_until + make_interval(days => $1) < CURRENT_DATE)`, [Math.floor(graceDays())]);
  for (const s of ending.rows) {
    await withSchool(s.id, async (c) => {
      await c.query(`UPDATE schools SET plan_state = 'expired' WHERE id = $1`, [s.id]);
      await logEvent(c, { schoolId: s.id, action: 'expired', fromPlan: s.plan, note: s.plan_state === 'demo' ? 'Demo ended' : 'Paid period and grace ended' });
    }).catch((e) => console.error('[plans] expiry failed:', e.message));
    await audit({ schoolId: s.id, action: 'plan.expired', detail: { from_state: s.plan_state } }).catch(() => {});
  }

  // 3) Heads-up in the school's own exception inbox: demo ending in ≤3 days,
  //    renewal due in 15 / 3 days, and the grace period.
  const soon = await pool.query(
    `SELECT id, plan_state, demo_ends_at, paid_until FROM schools
      WHERE (plan_state = 'demo' AND demo_ends_at BETWEEN NOW() AND NOW() + INTERVAL '3 days')
         OR (plan_state = 'paid' AND paid_until BETWEEN CURRENT_DATE - make_interval(days => $1) AND CURRENT_DATE + 15)`,
    [Math.floor(graceDays())]);
  for (const s of soon.rows) {
    const isDemo = s.plan_state === 'demo';
    const endsAt = isDemo ? new Date(s.demo_ends_at) : new Date(s.paid_until);
    const days = Math.ceil((endsAt - Date.now()) / DAY_MS);
    const bucket = isDemo ? 'demo3d' : days < 0 ? 'grace' : days <= 3 ? '3d' : '15d';
    await raiseException({
      schoolId: s.id, source: 'billing', severity: isDemo || days <= 3 ? 'high' : 'medium',
      title: isDemo ? `Waynur demo ends in ${Math.max(days, 0)} day(s)` : days < 0 ? 'Waynur plan has expired — grace period running' : `Waynur plan renews in ${days} day(s)`,
      body: 'Contact Waynur to continue. When the period ends the account becomes read-only (all data stays safe).',
      suggestedAction: 'Contact Waynur to renew', dedupeKey: `plan:${s.id}:${bucket}:${String(s.paid_until || s.demo_ends_at).slice(0, 10)}`,
    }).catch(() => {});
  }
  return { downgrades_applied: due.rowCount, expired: ending.rowCount, reminders: soon.rowCount };
}
