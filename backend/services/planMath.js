// Pure rules for the Core (₹400) / AI (₹650) per-student plans.
// No database access here, so everything is unit-testable.
//
// schools columns used:
//   plan            'core' | 'ai' (new plans) or 'starter'/'growth'/'district' (retired)
//   plan_state      'none'   — new school, nothing set yet (works, no AI)
//                   'demo'   — free trial of the AI plan until demo_ends_at
//                   'paid'   — paid until paid_until (manual payment by Super Admin)
//                   'expired'— demo/paid period over → account read-only
//                   'legacy' — school still on a retired plan (old billing rules apply)
//   demo_ends_at, paid_until, pending_plan_code (downgrade booked for the period end)

export const NEW_PLANS = ['core', 'ai'];
export const DAY_MS = 86400000;

export function graceDays() {
  const v = Number(process.env.PLAN_GRACE_DAYS);
  return Number.isFinite(v) && v >= 0 ? v : 7;
}

// Yearly price before GST, in paise: students × per-student rate, never below the minimum.
export function yearlyPricePaise(plan, students) {
  const per = Number(plan?.per_student_yearly_paise || 0);
  const min = Number(plan?.min_yearly_paise || 0);
  const n = Math.max(0, Math.floor(Number(students) || 0));
  return Math.max(n * per, min);
}

export function gstPaise(paise) {
  return Math.round(Number(paise) * 0.18);
}

// What a mid-year Core → AI upgrade costs: the difference in yearly price for
// the days left in the paid period. Downgrades never refund (they apply at the
// period end), so this is never negative.
export function prorateUpgradePaise({ fromPlan, toPlan, students, paidUntil, now = new Date() }) {
  if (!paidUntil) return yearlyPricePaise(toPlan, students);
  const end = new Date(paidUntil);
  const daysLeft = Math.max(0, Math.ceil((end - now) / DAY_MS));
  if (daysLeft === 0) return yearlyPricePaise(toPlan, students);
  const diff = yearlyPricePaise(toPlan, students) - yearlyPricePaise(fromPlan, students);
  return Math.max(0, Math.round(diff * Math.min(daysLeft, 365) / 365));
}

// The state a school is really in right now (stored plan_state can lag the
// clock until the sweep runs, so every check goes through this).
export function effectiveState(school, now = new Date()) {
  if (!school) return 'none';
  let st = school.plan_state || 'legacy';
  // A school still on a retired plan (starter/growth/district) follows the
  // old billing rules no matter how its plan_state was defaulted.
  if (!NEW_PLANS.includes(school.plan) && (st === 'none' || st === 'legacy')) st = 'legacy';
  if (st === 'demo') {
    return school.demo_ends_at && new Date(school.demo_ends_at) <= now ? 'demo_expired' : 'demo';
  }
  if (st === 'paid') {
    if (!school.paid_until) return 'paid';
    const end = endOfDay(school.paid_until);
    if (now <= end) return 'paid';
    return now <= new Date(end.getTime() + graceDays() * DAY_MS) ? 'grace' : 'expired';
  }
  return st; // 'none' | 'expired' | 'legacy'
}

// Writes are blocked (GETs still work) once a demo or paid period is over.
export function isPlanReadOnly(school, now = new Date()) {
  const s = effectiveState(school, now);
  return s === 'demo_expired' || s === 'expired';
}

// Does this school get the AI features?
//  - AI plan in an active demo, paid period or grace → yes
//  - Core plan, or anything expired → no
//  - Retired plans (legacy) keep AI so nothing changes until they are moved
export function hasAi(school, now = new Date()) {
  if (!school) return false;
  const s = effectiveState(school, now);
  if (s === 'legacy') return !NEW_PLANS.includes(school.plan) || school.plan === 'ai';
  if (s === 'expired' || s === 'demo_expired') return false;
  return school.plan === 'ai';
}

// paid_until is a DATE: the school keeps access for that whole day (IST).
// pg hands DATE columns back as a JS Date at local midnight, so read the
// calendar day with local getters rather than through UTC.
export function endOfDay(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = d instanceof Date
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    : String(d).slice(0, 10);
  return new Date(`${ymd}T23:59:59+05:30`);
}

// Default paid period: one year from the start date (start + 1 year − 1 day).
export function defaultPeriodEnd(startDate) {
  const s = new Date(`${String(startDate).slice(0, 10)}T00:00:00Z`);
  const e = new Date(Date.UTC(s.getUTCFullYear() + 1, s.getUTCMonth(), s.getUTCDate() - 1));
  return e.toISOString().slice(0, 10);
}

export function isDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
}
