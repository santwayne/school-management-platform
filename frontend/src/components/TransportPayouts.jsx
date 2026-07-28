import React, { useEffect, useState } from 'react';
import { IndianRupee, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { apiRequest } from '../api';

function Th({ children }) {
  return <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">{children}</th>;
}
function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default function TransportPayouts() {
  const [month, setMonth] = useState(currentMonth());
  const [routes, setRoutes] = useState(null);
  const [payouts, setPayouts] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  const load = async () => {
    setError('');
    try {
      const [profitability, payoutList] = await Promise.all([
        apiRequest(`/api/transport/route-profitability?billing_month=${month}`),
        apiRequest('/api/transport/payouts?status=pending'),
      ]);
      setRoutes(profitability.routes);
      setPayouts(payoutList);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    setRoutes(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const setPayoutStatus = async (id, status) => {
    setBusy(id);
    try {
      await apiRequest(`/api/transport/payouts/${id}/status`, { method: 'PATCH', body: { status } });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink">Transport — Driver Payout & Route Profitability</h1>
          <p className="text-sm text-ink-soft">Driver payout and student fee collection are tracked independently, joined here only for reporting.</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="px-3 py-2 rounded-xl border border-cream-deep bg-white text-sm"
        />
      </div>

      {error && <div className="text-sm text-terracotta-deep">{error}</div>}

      <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Route</Th>
              <Th>Driver</Th>
              <Th>Students Enrolled</Th>
              <Th>Fee Collected</Th>
              <Th>Fee Expected</Th>
              <Th>Driver Payout</Th>
              <Th>Margin</Th>
            </tr>
          </thead>
          <tbody>
            {routes === null && (
              <tr><Td className="text-ink-soft" colSpan={7}>Loading…</Td></tr>
            )}
            {routes?.length === 0 && (
              <tr><Td className="text-ink-soft" colSpan={7}>No routes yet — register a bus first.</Td></tr>
            )}
            {routes?.map((r) => (
              <tr key={r.bus_id} className="border-t border-cream-deep/50">
                <Td className="font-medium text-ink">{r.route_name || `Bus #${r.bus_id}`}</Td>
                <Td>{r.driver_name || '—'}</Td>
                <Td>{r.students_enrolled}</Td>
                <Td>{inr(r.fee_collected)}</Td>
                <Td className="text-ink-soft">{inr(r.fee_expected)}</Td>
                <Td>{inr(r.driver_payout)}</Td>
                <Td>
                  <span className={`inline-flex items-center gap-1 font-medium ${r.margin >= 0 ? 'text-emerald-700' : 'text-terracotta-deep'}`}>
                    {r.margin >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {inr(r.margin)}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="font-display text-lg text-ink mb-3 flex items-center gap-2"><Wallet size={18} /> Pending Driver Payouts</h2>
        <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Route</Th>
                <Th>Period</Th>
                <Th>Total KM</Th>
                <Th>Rate/KM</Th>
                <Th>Amount</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {payouts?.length === 0 && (
                <tr><Td className="text-ink-soft" colSpan={6}>Nothing pending.</Td></tr>
              )}
              {payouts?.map((p) => (
                <tr key={p.id} className="border-t border-cream-deep/50">
                  <Td className="font-medium text-ink">{p.route_name || `Bus #${p.bus_id}`}</Td>
                  <Td className="text-ink-soft">{p.period_start} → {p.period_end}</Td>
                  <Td>{Number(p.total_km).toFixed(1)} km</Td>
                  <Td>{inr(p.rate_per_km)}</Td>
                  <Td className="font-medium flex items-center gap-1"><IndianRupee size={12} />{Number(p.calculated_amount).toLocaleString('en-IN')}</Td>
                  <Td>
                    <button
                      disabled={busy === p.id}
                      onClick={() => setPayoutStatus(p.id, 'approved')}
                      className="px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition disabled:opacity-50"
                    >
                      Approve
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
