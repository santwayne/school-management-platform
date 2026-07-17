import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Receipt, IndianRupee } from 'lucide-react';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';

const INR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

export default function AccountantHome() {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [pendingWA, setPendingWA] = useState([]);
  const [pettyCash, setPettyCash] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiRequest('/api/reports/overview'),
      apiRequest('/api/fee-intake/pending'),
      apiRequest('/api/finance/petty-cash'),
    ])
      .then(([o, wa, pc]) => {
        setOverview(o);
        setPendingWA(wa);
        setPettyCash(pc.filter((p) => p.status === 'PENDING'));
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-ink">Good day, {user?.name?.split(' ')[0] || 'there'}</h1>
        <p className="text-sm text-ink-soft mt-1">Here's today's finance snapshot.</p>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      {overview && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-ink-soft">Collected this month</span>
              <IndianRupee className="w-4 h-4 text-terracotta-deep" />
            </div>
            <div className="font-display text-2xl text-ink">{INR(overview.fees_this_month)}</div>
          </div>
          <Link to="/accountant/fee-collection" className="rounded-2xl bg-white border border-cream-deep/70 p-5 hover:border-terracotta/60 transition">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-ink-soft">WhatsApp cash pending</span>
              <Wallet className="w-4 h-4 text-terracotta-deep" />
            </div>
            <div className="font-display text-2xl text-ink">{pendingWA.length}</div>
          </Link>
          <Link to="/accountant/payroll" className="rounded-2xl bg-white border border-cream-deep/70 p-5 hover:border-terracotta/60 transition">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-ink-soft">Petty cash pending</span>
              <Receipt className="w-4 h-4 text-terracotta-deep" />
            </div>
            <div className="font-display text-2xl text-ink">{pettyCash.length}</div>
          </Link>
        </div>
      )}

      <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
        <h3 className="font-display text-lg text-ink mb-4">Recent activity</h3>
        {overview && overview.activity.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-cream-deep/60">
            {overview?.activity.map((a, i) => (
              <li key={i} className="py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-cream-deep/70 flex items-center justify-center text-xs font-medium text-ink-soft shrink-0">
                  {a.type === 'payment' ? '₹' : '📢'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink">
                    {a.type === 'payment' ? (
                      <><span className="font-medium">{a.who}</span> <span className="text-ink-soft">paid {INR(a.amount)}</span></>
                    ) : (
                      <><span className="text-ink-soft">Broadcast sent to</span> <span className="font-medium">{a.who}</span></>
                    )}
                  </p>
                  <p className="text-xs text-ink-soft/80 mt-0.5">{new Date(a.when).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
