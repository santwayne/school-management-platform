import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';

const INR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

// Real prices, matching the pricing shown on the public site and in each
// school's own Billing page — the only thing "estimated" here is treating
// every active school as paying full price for their tier, since there's
// no real subscription-payment ledger yet (see note below).
const PLAN_PRICES = { starter: 4999, growth: 12999, district: 29999 };

export default function SuperAdminBilling() {
  const [schools, setSchools] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest('/api/super-admin/schools')
      .then(setSchools)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const activeSchools = schools.filter((s) => s.status === 'active');
  const byPlan = ['starter', 'growth', 'district'].map((plan) => {
    const list = activeSchools.filter((s) => (s.plan || 'starter') === plan);
    return { plan, count: list.length, mrr: list.length * PLAN_PRICES[plan] };
  });
  const totalMRR = byPlan.reduce((a, p) => a + p.mrr, 0);
  // Real Razorpay subscriptions now exist (routes/billing.js POST
  // /subscribe) for any school that's paid online — billing_status is
  // informational only by product decision, surfaced here for Super Admin
  // review rather than auto-restricting a school's access.
  const pastDue = activeSchools.filter((s) => s.billing_status === 'past_due');
  const subscribedCount = activeSchools.filter((s) => s.razorpay_subscription_id).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-ink">Subscriptions & Billing</h1>
        <p className="text-sm text-ink-soft mt-1">What Wayne E Solutions bills each school for Waynur.</p>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {loading && <p className="text-sm text-ink-soft">Loading…</p>}

      {!loading && (
        <>
          {pastDue.length > 0 && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              <span className="font-medium">{pastDue.length} school{pastDue.length > 1 ? 's have' : ' has'} a past-due Razorpay subscription:</span>{' '}
              {pastDue.map((s) => s.name).join(', ')} — not auto-restricted, just flagged for follow-up.
            </div>
          )}

          <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
            <div className="text-xs uppercase tracking-wider text-ink-soft">Estimated MRR</div>
            <div className="font-display text-3xl text-ink mt-1">{INR(totalMRR)}</div>
            <p className="text-xs text-ink-soft mt-2">
              Calculated from active schools × their plan's list price — still an estimate for schools on a manually-set
              plan. {subscribedCount} of {activeSchools.length} active school{activeSchools.length === 1 ? '' : 's'} pay
              through a real Razorpay subscription (school Billing page → Subscribe); the rest are still on a
              manually-set plan with no payment collected through the platform.
            </p>
          </div>

          <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
            <h2 className="font-display text-xl text-ink mb-4">Plan tiers</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              {byPlan.map((p) => (
                <div key={p.plan} className="rounded-xl bg-cream-deep/30 p-4">
                  <div className="text-xs uppercase tracking-wider text-ink-soft capitalize">{p.plan}</div>
                  <div className="font-display text-xl text-ink mt-1">{p.count} school{p.count !== 1 ? 's' : ''}</div>
                  <div className="text-xs text-ink-soft mt-0.5">{INR(p.mrr)}/mo</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
            <h2 className="font-display text-xl text-ink mb-2">Recent transactions</h2>
            <p className="text-sm text-ink-soft">
              A per-charge transaction ledger isn't stored yet — only each school's current subscription status
              (above) and renewal date. Razorpay's own dashboard has the full charge-by-charge history for any
              subscription started through the platform.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
