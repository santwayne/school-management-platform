import React, { useState } from 'react';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';

const INR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const ALL_TABS = [
  { key: 'attendance', label: 'Attendance' },
  { key: 'fees', label: 'Fee collection' },
  { key: 'payroll', label: 'Payroll register' },
];

function Th({ children }) {
  return <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">{children}</th>;
}
function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function AdminReports() {
  const { user } = useAuth();
  const TABS = user?.role === 'accountant' ? ALL_TABS.filter((t) => t.key !== 'attendance') : ALL_TABS;
  const [tab, setTab] = useState(TABS[0].key);
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="font-display text-3xl text-ink">Reports</h1>
        <p className="text-sm text-ink-soft mt-1">Pull attendance, fee collection, and payroll data for any date range.</p>
      </div>
      <div className="border-b border-cream-deep/70 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t.key ? 'border-terracotta text-terracotta-deep' : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'attendance' && <AttendanceReport />}
      {tab === 'fees' && <FeesReport />}
      {tab === 'payroll' && <PayrollReport />}
    </div>
  );
}

function ExportNote() {
  return (
    <p className="text-xs text-ink-soft flex items-center gap-1">
      PDF / Excel export isn't wired yet — this preview shows the live data; ask Sant to add real file generation before relying on the export buttons.
    </p>
  );
}

function AttendanceReport() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await apiRequest(`/api/reports/attendance?from=${from}&to=${to}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs font-medium text-ink-soft mb-1">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm" />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-ink-soft mb-1">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm" />
        </label>
        <button onClick={run} className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition">
          Generate
        </button>
      </div>
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {loading && <p className="text-sm text-ink-soft">Loading…</p>}
      {rows && (
        <>
          <ExportNote />
          <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><Th>Student</Th><Th>Class</Th><Th>Present</Th><Th>Absent</Th><Th>Late</Th><Th>Days marked</Th></tr></thead>
                <tbody className="divide-y divide-cream-deep/60">
                  {rows.rows.map((r) => (
                    <tr key={r.student_id} className="hover:bg-cream-deep/20">
                      <Td className="font-medium">{r.student_name}</Td>
                      <Td>{r.class_name}</Td>
                      <Td>{r.present_days}</Td>
                      <Td>{r.absent_days}</Td>
                      <Td>{r.late_days}</Td>
                      <Td>{r.total_marked}</Td>
                    </tr>
                  ))}
                  {rows.rows.length === 0 && (
                    <tr><Td className="text-ink-soft" colSpan={6}>No attendance records in this range.</Td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FeesReport() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await apiRequest(`/api/reports/fees?from=${from}&to=${to}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs font-medium text-ink-soft mb-1">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm" />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-ink-soft mb-1">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm" />
        </label>
        <button onClick={run} className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition">
          Generate
        </button>
      </div>
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {loading && <p className="text-sm text-ink-soft">Loading…</p>}
      {data && (
        <>
          <ExportNote />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {data.summary.map((s) => (
              <div key={s.payment_mode} className="rounded-2xl bg-white border border-cream-deep/70 p-5">
                <div className="text-xs uppercase tracking-wider text-ink-soft">{s.payment_mode}</div>
                <div className="font-display text-2xl mt-1 text-ink">{INR(s.total_collected)}</div>
                <div className="text-xs text-ink-soft mt-0.5">{s.transaction_count} transactions</div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><Th>Student</Th><Th>Amount</Th><Th>Mode</Th><Th>Date</Th></tr></thead>
                <tbody className="divide-y divide-cream-deep/60">
                  {data.transactions.map((t) => (
                    <tr key={t.id} className="hover:bg-cream-deep/20">
                      <Td className="font-medium">{t.student_name}</Td>
                      <Td>{INR(t.amount_paid)}</Td>
                      <Td>{t.payment_mode}</Td>
                      <Td className="text-ink-soft whitespace-nowrap">{new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PayrollReport() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await apiRequest(`/api/reports/payroll?month=${month}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs font-medium text-ink-soft mb-1">Month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm" />
        </label>
        <button onClick={run} className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition">
          Generate
        </button>
      </div>
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {loading && <p className="text-sm text-ink-soft">Loading…</p>}
      {rows && (
        <>
          <ExportNote />
          <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><Th>Teacher</Th><Th>Gross</Th><Th>Deductions</Th><Th>Net</Th><Th>Status</Th><Th>Paid on</Th></tr></thead>
                <tbody className="divide-y divide-cream-deep/60">
                  {rows.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-cream-deep/20">
                      <Td className="font-medium">{r.teacher_name}</Td>
                      <Td>{INR(r.gross_amount)}</Td>
                      <Td>{INR(r.deductions)}</Td>
                      <Td>{INR(r.net_amount)}</Td>
                      <Td>{r.status}</Td>
                      <Td className="text-ink-soft whitespace-nowrap">{r.paid_at ? new Date(r.paid_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</Td>
                    </tr>
                  ))}
                  {rows.rows.length === 0 && (
                    <tr><Td className="text-ink-soft" colSpan={6}>No payroll run recorded for this month.</Td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
