import React, { useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
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

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Export helpers ────────────────────────────────────────────────────────────

function buildPDF(type, data, rangeLabel) {
  const doc = new jsPDF();
  const titles = {
    attendance: 'Attendance Report',
    fees: 'Fee Collection Report',
    payroll: 'Payroll Register',
  };

  doc.setFontSize(16);
  doc.text(titles[type], 14, 18);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(rangeLabel, 14, 25);

  if (type === 'attendance') {
    autoTable(doc, {
      startY: 31,
      head: [['Student', 'Class', 'Present', 'Absent', 'Late', 'Days Marked']],
      body: data.rows.map((r) => [r.student_name, r.class_name, r.present_days, r.absent_days, r.late_days, r.total_marked]),
      styles: { fontSize: 9 },
    });
  } else if (type === 'fees') {
    autoTable(doc, {
      startY: 31,
      head: [['Mode', 'Total Collected', 'Transactions']],
      body: data.summary.map((s) => [s.payment_mode, INR(s.total_collected), s.transaction_count]),
      styles: { fontSize: 9 },
    });
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Student', 'Amount', 'Mode', 'Date']],
      body: data.transactions.map((t) => [t.student_name, INR(t.amount_paid), t.payment_mode, fmtDate(t.created_at)]),
      styles: { fontSize: 9 },
    });
  } else if (type === 'payroll') {
    autoTable(doc, {
      startY: 31,
      head: [['Teacher', 'Gross', 'Deductions', 'Net', 'Status', 'Paid On']],
      body: data.rows.map((r) => [
        r.teacher_name,
        INR(r.gross_amount),
        INR(r.deductions),
        INR(r.net_amount),
        r.status,
        r.paid_at ? fmtDate(r.paid_at) : '—',
      ]),
      styles: { fontSize: 9 },
    });
  }

  doc.save(`${type}-report.pdf`);
}

function buildExcel(type, data) {
  const wb = XLSX.utils.book_new();

  if (type === 'attendance') {
    const ws = XLSX.utils.json_to_sheet(
      data.rows.map((r) => ({
        Student: r.student_name,
        Class: r.class_name,
        Present: r.present_days,
        Absent: r.absent_days,
        Late: r.late_days,
        'Days Marked': r.total_marked,
      }))
    );
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
  } else if (type === 'fees') {
    const wsSummary = XLSX.utils.json_to_sheet(
      data.summary.map((s) => ({
        Mode: s.payment_mode,
        'Total Collected (INR)': Number(s.total_collected),
        Transactions: s.transaction_count,
      }))
    );
    const wsTxn = XLSX.utils.json_to_sheet(
      data.transactions.map((t) => ({
        Student: t.student_name,
        'Amount (INR)': Number(t.amount_paid),
        Mode: t.payment_mode,
        Date: fmtDate(t.created_at),
      }))
    );
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    XLSX.utils.book_append_sheet(wb, wsTxn, 'Transactions');
  } else if (type === 'payroll') {
    const ws = XLSX.utils.json_to_sheet(
      data.rows.map((r) => ({
        Teacher: r.teacher_name,
        'Gross (INR)': Number(r.gross_amount),
        'Deductions (INR)': Number(r.deductions),
        'Net (INR)': Number(r.net_amount),
        Status: r.status,
        'Paid On': r.paid_at ? fmtDate(r.paid_at) : '',
      }))
    );
    XLSX.utils.book_append_sheet(wb, ws, 'Payroll');
  }

  XLSX.writeFile(wb, `${type}-report.xlsx`);
}

function ExportButtons({ type, data, rangeLabel }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => buildPDF(type, data, rangeLabel)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-deep bg-white text-xs font-medium text-ink hover:bg-cream-deep/40 transition"
      >
        <svg className="w-3.5 h-3.5 text-ink-soft" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        Export PDF
      </button>
      <button
        onClick={() => buildExcel(type, data)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-deep bg-white text-xs font-medium text-ink hover:bg-cream-deep/40 transition"
      >
        <svg className="w-3.5 h-3.5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
        Export Excel
      </button>
    </div>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

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

// ── Report panels ─────────────────────────────────────────────────────────────

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

  const rangeLabel = `${from} to ${to}`;

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
          <ExportButtons type="attendance" data={rows} rangeLabel={rangeLabel} />
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

  const rangeLabel = `${from} to ${to}`;

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
          <ExportButtons type="fees" data={data} rangeLabel={rangeLabel} />
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
                      <Td className="text-ink-soft whitespace-nowrap">{fmtDate(t.created_at)}</Td>
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
          <ExportButtons type="payroll" data={rows} rangeLabel={`Month: ${month}`} />
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
                      <Td className="text-ink-soft whitespace-nowrap">{r.paid_at ? fmtDate(r.paid_at) : '—'}</Td>
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
