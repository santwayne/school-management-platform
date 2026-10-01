import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api';

// App-wide strip for Principal/Accountant: failed payment, grace countdown,
// read-only. Silent when billing is healthy (and for roles that can't see
// billing — the GET simply 403s and we render nothing).
export default function BillingBanner() {
  const [b, setB] = useState(null);
  useEffect(() => {
    apiRequest('/api/billing').then(setB).catch(() => setB(null));
  }, []);
  if (!b) return null;

  let tone = 'amber';
  let text = null;
  if (b.read_only) {
    tone = 'red';
    text = 'Your Waynur subscription is inactive, so the account is read-only. Data is safe and viewable; renew to resume editing.';
  } else if (b.billing_status === 'halted') {
    const days = b.grace_until ? Math.max(0, Math.ceil((new Date(b.grace_until) - Date.now()) / 86400000)) : null;
    tone = 'red';
    text = `Plan payment failed after all retries. The account becomes read-only${days !== null ? ` in ${days} day${days === 1 ? '' : 's'}` : ' soon'} unless you pay.`;
  } else if (b.billing_status === 'payment_pending') {
    text = 'Your last plan payment did not go through. Razorpay will retry; updating the payment method avoids interruption.';
  } else if (b.billing_status === 'cancelled' && b.renews_at) {
    text = `Subscription cancelled. Full access continues until ${new Date(b.renews_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}.`;
  }
  if (!text) return null;

  const cls = tone === 'red'
    ? 'bg-destructive/10 border-destructive/30 text-destructive'
    : 'bg-amber-500/10 border-amber-500/30 text-amber-900';
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-3 ${cls}`}>
      <span>{text}</span>
      {b.can_manage && (
        <Link to="/admin/billing" className="shrink-0 font-medium underline underline-offset-2">Go to Billing</Link>
      )}
    </div>
  );
}
