import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { apiRequest } from '../api';

const INR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

// Same terracotta/cream palette used across AdminHome.jsx / SuperAdminHome.jsx
// (frontend/tailwind.config.js), passed straight through as CSS oklch()
// strings — recharts fill/stroke accept any valid CSS color.
const SLICE_COLORS = [
  'oklch(0.60 0.19 38)',  // terracotta
  'oklch(0.82 0.15 78)',  // amber-warm
  'oklch(0.84 0.16 85)',  // joy-gold
  'oklch(0.76 0.15 150)', // joy-leaf
  'oklch(0.78 0.12 235)', // joy-sky
  'oklch(0.70 0.19 350)', // joy-berry
  'oklch(0.75 0.13 300)', // joy-lilac
];

function Card({ title, subtitle, children, className = '' }) {
  return (
    <div className={`rounded-2xl bg-white border border-cream-deep/70 p-5 ${className}`}>
      <div className="mb-4">
        <h3 className="font-display text-lg text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-soft mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function StatTile({ label, value, tone = 'default' }) {
  const toneClass = tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-terracotta-deep' : 'text-ink';
  return (
    <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
      <div className="text-xs uppercase tracking-wider text-ink-soft">{label}</div>
      <div className={`font-display text-2xl mt-1 ${toneClass}`}>{value}</div>
    </div>
  );
}

function EmptyChart({ message }) {
  return (
    <div className="h-56 flex items-center justify-center">
      <p className="text-sm text-ink-soft">{message}</p>
    </div>
  );
}

const PAGE_SIZE = 10;

export default function FeeDashboard() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    apiRequest(`/api/finance/fee/dashboard?page=${page}&pageSize=${PAGE_SIZE}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [page]);

  if (loading && !data) return <p className="text-sm text-ink-soft">Loading…</p>;
  if (error && !data) return <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>;
  if (!data) return null;

  const { summary, collected_by_class, due_by_class, by_payment_mode, recent_transactions } = data;

  const dueTotal = due_by_class.reduce((a, r) => a + r.unpaid, 0);
  const dueSlices = due_by_class.filter((r) => r.unpaid > 0);
  const modeSlices = by_payment_mode.filter((r) => r.amount > 0);
  const hasAnyCollection = collected_by_class.some((r) => r.collected > 0);

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      {/* Total Fees summary card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile label="Total Expected" value={INR(summary.total_expected)} />
        <StatTile label="Total Paid" value={INR(summary.total_paid)} tone="positive" />
        <StatTile label="Total Unpaid" value={INR(summary.total_unpaid)} tone="negative" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fees Collected bar chart */}
        <Card title="Fees collected by grade" subtitle="Total amount received, per class">
          {hasAnyCollection ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={collected_by_class} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.02 76)" vertical={false} />
                  <XAxis dataKey="class_name" fontSize={10} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [INR(v), 'Collected']} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="collected" fill="oklch(0.60 0.19 38)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart message="No fee collections recorded yet." />
          )}
        </Card>

        {/* Due Amount pie chart */}
        <Card title="Due amount by grade" subtitle="Share of unpaid fees across classes">
          {dueSlices.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={dueSlices}
                    dataKey="unpaid"
                    nameKey="class_name"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={2}
                    label={({ class_name, unpaid }) => `${class_name} ${dueTotal ? Math.round((unpaid / dueTotal) * 100) : 0}%`}
                  >
                    {dueSlices.map((_, i) => <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [INR(v), 'Unpaid']} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart message="No unpaid fees to show — every recorded due amount is settled." />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Mode pie chart */}
        <Card title="Payment mode distribution" subtitle="Collected amount by how it was paid">
          {modeSlices.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={modeSlices} dataKey="amount" nameKey="payment_mode" innerRadius={45} outerRadius={80} paddingAngle={2}>
                    {modeSlices.map((_, i) => <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [INR(v), n]} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart message="No payments recorded yet." />
          )}
        </Card>

        {/* Recent Transactions table */}
        <Card title="Recent transactions" subtitle="Most recent fee payments first" className="lg:col-span-1">
          {recent_transactions.rows.length === 0 ? (
            <EmptyChart message="No transactions recorded yet." />
          ) : (
            <>
              <div className="overflow-x-auto -mx-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-5 py-2">Student</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-5 py-2">Amount</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-5 py-2">Method</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-5 py-2">Class</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-5 py-2">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cream-deep/60">
                    {recent_transactions.rows.map((t) => (
                      <tr key={t.id} className="hover:bg-cream-deep/20">
                        <td className="px-5 py-2.5 font-medium text-ink">{t.student_name} <span className="text-ink-soft font-normal">#{t.student_id}</span></td>
                        <td className="px-5 py-2.5">{INR(t.amount_paid)}</td>
                        <td className="px-5 py-2.5">{t.payment_mode}</td>
                        <td className="px-5 py-2.5">{t.class_name}</td>
                        <td className="px-5 py-2.5 text-ink-soft whitespace-nowrap">
                          {new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-cream-deep/60">
                <span className="text-xs text-ink-soft">
                  Page {recent_transactions.page} of {recent_transactions.totalPages} · {recent_transactions.total} total
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 rounded-lg border border-cream-deep text-xs font-medium text-ink hover:bg-cream-deep/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(recent_transactions.totalPages, p + 1))}
                    disabled={page >= recent_transactions.totalPages}
                    className="px-3 py-1.5 rounded-lg border border-cream-deep text-xs font-medium text-ink hover:bg-cream-deep/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
