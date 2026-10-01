// Pure billing helpers — no DB, no network — so they're unit-testable.
// All money is integer paise to avoid float rounding on GST.

export const GST_RATE = 0.18;
export const SAC_CODE = '998314'; // IT design & development services / SaaS
export const DEFAULT_GRACE_DAYS = 7;

export function withGst(paise) {
  return Math.round(paise * (1 + GST_RATE));
}

// Split a GST-INCLUSIVE amount actually paid into taxable value + tax.
// Intra-state supply (school in the supplier's state) → CGST 9% + SGST 9%;
// inter-state or unknown state → IGST 18%. Totals always reconcile exactly
// to the amount Razorpay captured (rounding difference goes to taxable).
export function splitGst(totalPaise, supplierStateCode, buyerStateCode) {
  const tax = Math.round(totalPaise - totalPaise / (1 + GST_RATE));
  const taxable = totalPaise - tax;
  const intra = !!supplierStateCode && !!buyerStateCode && supplierStateCode === buyerStateCode;
  if (intra) {
    const cgst = Math.floor(tax / 2);
    return { taxable, cgst, sgst: tax - cgst, igst: 0, total: totalPaise };
  }
  return { taxable, cgst: 0, sgst: 0, igst: tax, total: totalPaise };
}

// Indian financial year (Apr–Mar) label for a date, IST.
export function financialYear(date = new Date()) {
  const ist = new Date(date.getTime() + 5.5 * 3600 * 1000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function formatInvoiceNumber(prefix, fy, seq) {
  return `${prefix}/${fy}/${String(seq).padStart(5, '0')}`;
}

// Upgrade proration: the school pays (new − old) list price for the unused
// fraction of the current period, GST on top. Never negative.
export function prorationPaise({ oldPricePaise, newPricePaise, periodStart, periodEnd, now = new Date() }) {
  const start = new Date(periodStart).getTime();
  const end = new Date(periodEnd).getTime();
  const t = now.getTime();
  if (!(end > start) || t >= end) return 0;
  const remaining = Math.min(1, Math.max(0, (end - Math.max(t, start)) / (end - start)));
  const diff = Math.max(0, newPricePaise - oldPricePaise);
  return Math.round(diff * remaining);
}

export function classifyChange(currentPlan, targetPlan) {
  if (!currentPlan || !targetPlan) return 'new';
  if (targetPlan.rank > currentPlan.rank) return 'upgrade';
  if (targetPlan.rank < currentPlan.rank) return 'downgrade';
  return 'same';
}

// Which limits would a downgrade break? Empty array = allowed.
export function downgradeBlockers(usage, targetPlan) {
  const out = [];
  if (usage.students > targetPlan.student_limit) {
    out.push(`${usage.students} students enrolled, ${targetPlan.name} allows ${targetPlan.student_limit}`);
  }
  if (usage.accountants > targetPlan.accountant_seats) {
    out.push(`${usage.accountants} accountant logins, ${targetPlan.name} allows ${targetPlan.accountant_seats}`);
  }
  return out;
}

// Can the school still write? Data is always readable; only writes stop.
//   halted   → read-only once the grace window has passed
//   cancelled → read-only once the paid period has ended
export function isReadOnly(school, now = new Date()) {
  if (!school) return false;
  if (school.billing_status === 'halted') {
    return !!school.billing_grace_until && new Date(school.billing_grace_until) <= now;
  }
  if (school.billing_status === 'cancelled') {
    return !!school.current_period_end && new Date(school.current_period_end) <= now;
  }
  return false;
}

// Razorpay webhook event → what the subscription row becomes.
export const SUBSCRIPTION_STATUS_FOR_EVENT = {
  'subscription.authenticated': 'authenticated',
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.resumed': 'active',
  'subscription.pending': 'pending',
  'subscription.halted': 'halted',
  'subscription.paused': 'halted',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'completed',
};
