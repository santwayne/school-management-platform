import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';

const INR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

function UsageRow({ label, used, limit }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="py-2.5">
      <div className="flex justify-between text-sm text-ink mb-1">
        <span>{label}</span>
        <span className="text-ink-soft">{used}{limit ? ` / ${limit === 999999 ? 'Unlimited' : limit}` : ''}</span>
      </div>
      {!!limit && limit !== 999999 && (
        <div className="h-2 rounded-full bg-cream-deep overflow-hidden">
          <div className="h-full bg-terracotta" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

const BILLING_STATUS_LABEL = {
  active: null, // nothing to show — the normal state
  pending_activation: { text: 'Subscription started — waiting for you to complete payment authorization.', tone: 'amber' },
  past_due: { text: "Your last subscription payment didn't go through. Your account isn't restricted, but please update your payment method soon.", tone: 'destructive' },
  cancelled: { text: 'Your subscription was cancelled. Subscribe again below to resume online payment.', tone: 'destructive' },
};

export default function AdminBilling() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [subscribing, setSubscribing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      setData(await apiRequest('/api/billing'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const changePlan = async (plan) => {
    if (!confirm(`Switch to the ${plan} plan? This updates your account but does not itself collect payment — a real billing flow needs to be wired before this is a self-serve action.`)) return;
    setChanging(true);
    setError('');
    try {
      await apiRequest('/api/billing/plan', { method: 'PATCH', body: { plan } });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setChanging(false);
    }
  };

  const subscribeAndPay = async (plan) => {
    setSubscribing(plan);
    setError('');
    try {
      const res = await apiRequest('/api/billing/subscribe', { method: 'POST', body: { plan } });
      // Razorpay's hosted page — completes the payment-method mandate.
      // The plan itself only actually switches once that's done and the
      // webhook fires (subscription.activated), not immediately here.
      window.open(res.short_url, '_blank', 'noopener,noreferrer');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubscribing(null);
    }
  };

  if (loading) return <p className="text-sm text-ink-soft">Loading…</p>;
  if (error && !data) return <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-ink">Billing</h1>
        <p className="text-sm text-ink-soft mt-1">Your plan and usage.</p>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      {BILLING_STATUS_LABEL[data.billing_status] && (
        <div className={`rounded-xl px-4 py-3 text-sm ${
          BILLING_STATUS_LABEL[data.billing_status].tone === 'destructive'
            ? 'bg-destructive/10 border border-destructive/20 text-destructive'
            : 'bg-amber-500/10 border border-amber-500/20 text-amber-800'
        }`}>
          {BILLING_STATUS_LABEL[data.billing_status].text}
        </div>
      )}

      <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
        <div className="font-display text-2xl text-ink">{data.plan_name} Plan</div>
        <div className="text-sm text-ink-soft mt-1">
          {INR(data.price)}/month · renews {data.renews_at ? new Date(data.renews_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
          {data.has_subscription && <span className="ml-2 text-xs text-emerald-700">· auto-renews via Razorpay</span>}
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
        <h2 className="font-display text-lg text-ink mb-2">Usage</h2>
        <UsageRow label="Students" used={data.usage.students.used} limit={data.usage.students.limit} />
        <UsageRow label="Staff" used={data.usage.staff.used} limit={data.usage.staff.limit} />
        <UsageRow label="Accountant seats" used={data.usage.accountant_seats.used} limit={data.usage.accountant_seats.limit} />
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {Object.entries(data.all_plans).map(([key, p]) => (
          <div key={key} className={`rounded-2xl border p-5 ${key === data.plan ? 'border-terracotta bg-terracotta/5' : 'border-cream-deep/70 bg-white'}`}>
            {key === data.plan && <span className="inline-block mb-2 text-xs font-medium px-2 py-0.5 rounded-full bg-terracotta text-primary-foreground">Your plan</span>}
            <div className="font-display text-lg text-ink">{p.name}</div>
            <div className="text-sm text-ink-soft mt-0.5">{INR(p.price)}/month</div>
            <ul className="text-xs text-ink-soft mt-3 space-y-1">
              <li>Up to {p.student_limit === 999999 ? 'unlimited' : p.student_limit} students</li>
              <li>{p.accountant_seats > 0 ? `${p.accountant_seats} accountant seats` : 'No accountant role'}</li>
            </ul>
            {key !== data.plan && data.plans_payable_online.includes(key) && (
              <button
                onClick={() => subscribeAndPay(key)}
                disabled={subscribing === key}
                className="mt-4 w-full px-3 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition disabled:opacity-50"
              >
                {subscribing === key ? 'Starting…' : `Subscribe & Pay — ${p.name}`}
              </button>
            )}
            {key !== data.plan && !data.plans_payable_online.includes(key) && (
              <button
                onClick={() => changePlan(key)}
                disabled={changing}
                className="mt-4 w-full px-3 py-2 rounded-lg border border-cream-deep text-ink text-sm font-medium hover:bg-cream-deep/40 transition disabled:opacity-50"
                title="Online payment isn't set up for this plan yet — this only updates your account, contact support to actually pay"
              >
                Switch to {p.name} (no payment)
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
