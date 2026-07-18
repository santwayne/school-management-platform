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
          <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
            <div className="text-xs uppercase tracking-wider text-ink-soft">Estimated MRR</div>
            <div className="font-display text-3xl text-ink mt-1">{INR(totalMRR)}</div>
            <p className="text-xs text-ink-soft mt-2">
              Calculated from active schools × their plan's list price. This is an estimate, not a real
              payment ledger — no subscription billing/invoicing system is wired yet, so this doesn't
              reflect actual amounts collected, discounts given, or overdue accounts.
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
              Not available yet — Wayne E Solutions doesn't currently collect subscription payments through
              the platform itself (schools are billed directly). Wiring a real transaction ledger here would
              need a Razorpay subscriptions integration, separate from the per-school fee-collection Razorpay
              flow that already exists.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
