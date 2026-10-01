// Super Admin plan catalog management.
//
// The plan catalog lives in the `plans` table. Each plan's monthly price is
// charged through a Razorpay Plan, and Razorpay Plans are immutable (amount
// and period can't change after creation). So:
//   - limits / name / yearly price  → plain DB update
//   - monthly price                 → create a NEW Razorpay Plan at the
//                                     GST-inclusive amount, then switch the ID
//   - existing subscribers keep paying the old plan's amount until they
//     change plan; new checkouts use the new plan.
//
// Plan ID resolution (billingService.getPlans): plans.razorpay_plan_id wins,
// RAZORPAY_PLAN_ID_<CODE> in .env is the fallback.
import pool from '../config/db.js';
import { razorpayClient } from '../utils/razorpay.js';
import { withGst } from './billingMath.js';

const MAX_PRICE_PAISE = 10_000_000_00; // ₹1 crore sanity cap
const UNLIMITED = 999999;

export function keyMode(keyId = process.env.RAZORPAY_KEY_ID) {
  if (!keyId) return 'none';
  if (keyId.startsWith('rzp_live_')) return 'live';
  if (keyId.startsWith('rzp_test_')) return 'test';
  return 'unknown';
}

function isWholeNumber(v) {
  return Number.isInteger(v) && v >= 0;
}

// Validates and normalises a PATCH body. Returns { changes, errors }.
// Prices arrive in rupees (what the Super Admin types) and are stored as paise.
export function validatePlanPatch(body = {}, current) {
  const errors = [];
  const changes = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2 || name.length > 50) errors.push('Name must be 2–50 characters');
    else if (name !== current.name) changes.name = name;
  }

  if (body.student_limit !== undefined) {
    const v = body.unlimited_students ? UNLIMITED : Number(body.student_limit);
    if (!isWholeNumber(v) || v < 1) errors.push('Student limit must be a whole number ≥ 1');
    else if (v !== current.student_limit) changes.student_limit = v;
  }

  if (body.accountant_seats !== undefined) {
    const v = Number(body.accountant_seats);
    if (!isWholeNumber(v) || v > 1000) errors.push('Accountant seats must be a whole number between 0 and 1000');
    else if (v !== current.accountant_seats) changes.accountant_seats = v;
  }

  if (body.price !== undefined) {
    const paise = Math.round(Number(body.price) * 100);
    if (!Number.isFinite(paise) || paise < 100 || paise > MAX_PRICE_PAISE) errors.push('Monthly price must be between ₹1 and ₹1,00,00,000');
    else if (paise !== Number(current.price_paise)) changes.price_paise = paise;
  }

  if (body.yearly_price !== undefined) {
    if (body.yearly_price === null || body.yearly_price === '') {
      if (current.yearly_price_paise !== null) changes.yearly_price_paise = null;
    } else {
      const paise = Math.round(Number(body.yearly_price) * 100);
      if (!Number.isFinite(paise) || paise < 100 || paise > MAX_PRICE_PAISE) errors.push('Yearly price must be between ₹1 and ₹1,00,00,000 (or empty to disable yearly)');
      else if (paise !== Number(current.yearly_price_paise)) changes.yearly_price_paise = paise;
    }
  }

  return { changes, errors };
}

// Checks that a Razorpay Plan object can bill a Waynur plan correctly.
// Returns a list of problems (empty = OK).
export function razorpayPlanProblems(rzpPlan, pricePaise) {
  const problems = [];
  if (!rzpPlan || !rzpPlan.id) return ['Plan not found in Razorpay'];
  const expected = withGst(Number(pricePaise));
  if (Number(rzpPlan.item?.amount) !== expected) {
    problems.push(`Amount is ₹${(Number(rzpPlan.item?.amount) / 100).toFixed(2)} but should be ₹${(expected / 100).toFixed(2)} (price + 18% GST)`);
  }
  if (rzpPlan.item?.currency && rzpPlan.item.currency !== 'INR') problems.push(`Currency is ${rzpPlan.item.currency}, must be INR`);
  if (rzpPlan.period !== 'monthly' || Number(rzpPlan.interval) !== 1) {
    problems.push(`Billing cycle is every ${rzpPlan.interval} ${rzpPlan.period}, must be every 1 monthly`);
  }
  return problems;
}

export async function listPlansForAdmin() {
  const { rows } = await pool.query(`
    SELECT p.*, (SELECT COUNT(*)::int FROM schools s WHERE s.plan = p.code) AS schools_on_plan
    FROM plans p ORDER BY p.rank`);
  return rows.map((p) => {
    const envId = process.env[`RAZORPAY_PLAN_ID_${p.code.toUpperCase()}`] || null;
    const effective = p.razorpay_plan_id || envId;
    return {
      code: p.code,
      name: p.name,
      price: Number(p.price_paise) / 100,
      price_with_gst: withGst(Number(p.price_paise)) / 100,
      yearly_price: p.yearly_price_paise ? Number(p.yearly_price_paise) / 100 : null,
      yearly_price_with_gst: p.yearly_price_paise ? withGst(Number(p.yearly_price_paise)) / 100 : null,
      student_limit: p.student_limit,
      unlimited_students: p.student_limit >= UNLIMITED,
      accountant_seats: p.accountant_seats,
      rank: p.rank,
      active: p.active,
      schools_on_plan: p.schools_on_plan,
      razorpay_plan_id: effective,
      razorpay_plan_source: p.razorpay_plan_id ? 'database' : envId ? 'env' : 'missing',
      db_plan_id: p.razorpay_plan_id,
      env_plan_id: envId,
      updated_at: p.updated_at,
    };
  });
}

export async function fetchRazorpayPlan(planId) {
  try {
    const { data } = await razorpayClient().get(`/plans/${encodeURIComponent(planId)}`);
    return data;
  } catch (err) {
    if (err.response?.status === 400 || err.response?.status === 404) return null;
    throw err;
  }
}

export async function createRazorpayPlan(plan, pricePaise = plan.price_paise) {
  const { data } = await razorpayClient().post('/plans', {
    period: 'monthly',
    interval: 1,
    item: {
      name: `Waynur ${plan.name}`,
      amount: withGst(Number(pricePaise)),
      currency: 'INR',
      description: `${plan.student_limit >= UNLIMITED ? 'Unlimited' : `Up to ${plan.student_limit}`} students, ${plan.accountant_seats} accountant seats (incl. 18% GST)`,
    },
    notes: { waynur_plan_code: plan.code, price_paise_pre_gst: String(pricePaise) },
  });
  return data;
}

export async function logPlanChange({ planCode, actorId, action, detail }, client = pool) {
  await client.query(
    `INSERT INTO plan_audit (plan_code, actor_id, action, detail) VALUES ($1, $2, $3, $4)`,
    [planCode, actorId || null, action, JSON.stringify(detail || {})]
  );
}

export async function listPlanAudit(limit = 30) {
  const { rows } = await pool.query(
    `SELECT id, plan_code, actor_id, action, detail, created_at FROM plan_audit ORDER BY id DESC LIMIT $1`, [limit]);
  return rows;
}
