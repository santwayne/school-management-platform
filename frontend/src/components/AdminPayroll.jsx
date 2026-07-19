import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Play, CheckCircle2, Pencil, Plus, X, Info } from 'lucide-react';
import { apiRequest } from '../api';

const INR = (n) => '₹' + Number(n).toLocaleString('en-IN');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const TABS = [
  { key: 'payroll', label: 'Payroll' },
  { key: 'salaries', label: 'Salaries' },
  { key: 'petty', label: 'Petty Cash' },
];

function Th({ children, className = '' }) {
  return <th className={`text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

export default function AdminPayroll() {
  const location = useLocation();
  const initialTab = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState(TABS.some((t) => t.key === initialTab) ? initialTab : 'payroll');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl text-ink">Staff &amp; Payroll</h1>
        <p className="text-sm text-ink-soft mt-1">Salaries, monthly runs and petty cash approvals.</p>
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
      {tab === 'payroll' && <PayrollTab />}
      {tab === 'salaries' && <SalariesTab />}
      {tab === 'petty' && <PettyCashTab />}
    </div>
  );
}

function SummaryTile({ label, value, tone }) {
  const cls = tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-terracotta-deep' : 'text-ink';
  return (
    <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
      <div className="text-xs uppercase tracking-wider text-ink-soft">{label}</div>
      <div className={`font-display text-2xl mt-1 ${cls}`}>{value}</div>
    </div>
  );
}

function PayrollTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const period = `${year}-${String(month + 1).padStart(2, '0')}`;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest(`/api/payroll?period=${period}`);
      setRows(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  function shift(delta) {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y--;
    }
    if (m > 11) {
      m = 0;
      y++;
    }
    setMonth(m);
    setYear(y);
  }

  const runPayroll = async () => {
    setError('');
    try {
      await apiRequest('/api/payroll/run', { method: 'POST', body: { period } });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const markPaid = async (id) => {
    setError('');
    try {
      await apiRequest(`/api/payroll/${id}/mark-paid`, { method: 'PATCH' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const total = rows?.reduce((s, r) => s + Number(r.amount_paid), 0) || 0;
  const paidCount = rows?.filter((r) => r.status === 'PAID').length || 0;
  const pendingCount = (rows?.length || 0) - paidCount;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex items-center rounded-lg border border-cream-deep bg-white overflow-hidden">
          <button onClick={() => shift(-1)} className="p-2 hover:bg-cream-deep/50 text-ink-soft"><ChevronLeft className="w-4 h-4" /></button>
          <div className="px-4 py-2 text-sm font-medium min-w-[140px] text-center">{MONTHS[month]} {year}</div>
          <button onClick={() => shift(1)} className="p-2 hover:bg-cream-deep/50 text-ink-soft"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <button
          onClick={runPayroll}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition"
        >
          <Play className="w-4 h-4" /> Run payroll for {MONTHS[month]}
        </button>
        <span className="text-xs text-ink-soft inline-flex items-center gap-1">
          <Info className="w-3 h-3" /> Re-running won't create duplicate entries.
        </span>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      {loading ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : rows && rows.length > 0 ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <SummaryTile label="Total payroll" value={INR(total)} />
            <SummaryTile label="Paid" value={`${paidCount} / ${rows.length}`} tone="ok" />
            <SummaryTile label="Pending" value={`${pendingCount}`} tone="warn" />
          </div>
          <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Teacher</Th><Th>Monthly salary</Th><Th>Status</Th><Th className="text-right">Action</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-deep/60">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-cream-deep/20">
                      <Td className="font-medium">{r.teacher_name}</Td>
                      <Td>{INR(r.amount_paid)}</Td>
                      <Td>
                        {r.status === 'PAID' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700"><CheckCircle2 className="w-3 h-3" /> Paid</span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-700">Pending</span>
                        )}
                      </Td>
                      <Td className="text-right">
                        {r.status !== 'PAID' && (
                          <button
                            onClick={() => markPaid(r.id)}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-terracotta/10 text-terracotta-deep hover:bg-terracotta/15 transition"
                          >
                            Mark as paid
                          </button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-cream-deep bg-white/60 p-10 text-center">
          <div className="font-display text-lg text-ink mb-1">No payroll run yet for {MONTHS[month]} {year}</div>
          <p className="text-sm text-ink-soft">Click "Run payroll for {MONTHS[month]}" to generate the list.</p>
        </div>
      )}
    </div>
  );
}

function SalariesTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(0);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await apiRequest('/api/payroll/salary'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (teacherId) => {
    setError('');
    try {
      await apiRequest('/api/payroll/salary', { method: 'POST', body: { teacher_id: teacherId, monthly_amount: draft } });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <p className="text-sm text-ink-soft">Loading…</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-soft inline-flex items-center gap-1">
        <Info className="w-3 h-3" /> Salary edits are effective from the next payroll run.
      </p>
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Teacher</Th><Th>Current salary</Th><Th className="text-right">Edit</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-deep/60">
              {rows.map((r) => (
                <tr key={r.teacher_id} className="hover:bg-cream-deep/20">
                  <Td className="font-medium">{r.name}</Td>
                  <Td>
                    {editing === r.teacher_id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={draft}
                          onChange={(e) => setDraft(Number(e.target.value))}
                          className="w-32 px-2 py-1 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
                        />
                        <button onClick={() => save(r.teacher_id)} className="text-xs font-medium px-2.5 py-1 rounded-lg bg-terracotta text-primary-foreground">Save</button>
                        <button onClick={() => setEditing(null)} className="text-xs px-2 py-1 rounded-lg text-ink-soft hover:bg-cream-deep/60">Cancel</button>
                      </div>
                    ) : (
                      <span>{r.monthly_amount ? INR(r.monthly_amount) : <span className="text-ink-soft">Not set</span>}</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    {editing !== r.teacher_id && (
                      <button
                        onClick={() => {
                          setEditing(r.teacher_id);
                          setDraft(r.monthly_amount || 0);
                        }}
                        className="p-1.5 rounded-md text-ink-soft hover:text-terracotta-deep hover:bg-terracotta/10"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
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

function FormField({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function StatusBadge({ status }) {
  const cls =
    status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-700' : status === 'REJECTED' ? 'bg-terracotta/15 text-terracotta-deep' : 'bg-amber-500/15 text-amber-700';
  const label = status === 'APPROVED' ? 'Approved' : status === 'REJECTED' ? 'Rejected' : 'Pending';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>;
}

function PettyCashTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [nName, setNName] = useState('');
  const [nAmt, setNAmt] = useState('');
  const [nReason, setNReason] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await apiRequest('/api/finance/petty-cash'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const decide = async (id, status) => {
    setError('');
    try {
      await apiRequest(`/api/finance/petty-cash/approve/${id}`, { method: 'PATCH', body: { status } });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const addRequest = async () => {
    if (!nName.trim() || !Number(nAmt) || !nReason.trim()) return;
    setError('');
    try {
      await apiRequest('/api/finance/petty-cash/request', {
        method: 'POST',
        body: { requested_by: nName.trim(), amount: Number(nAmt), purpose: nReason.trim() },
      });
      setNewOpen(false);
      setNName('');
      setNAmt('');
      setNReason('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <p className="text-sm text-ink-soft">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-soft">Approvals from the Principal.</p>
        <button
          onClick={() => setNewOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition"
        >
          <Plus className="w-4 h-4" /> New request
        </button>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Staff</Th><Th>Amount</Th><Th>Reason</Th><Th>Date</Th><Th>Status</Th><Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-deep/60">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-cream-deep/20 align-top">
                  <Td className="font-medium">{r.requested_by}</Td>
                  <Td>{INR(r.amount)}</Td>
                  <Td className="text-ink-soft max-w-md">{r.purpose}</Td>
                  <Td className="text-ink-soft whitespace-nowrap">{new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td className="text-right">
                    {r.status === 'PENDING' && (
                      <div className="inline-flex items-center gap-2">
                        <button onClick={() => decide(r.id, 'REJECTED')} className="text-xs px-3 py-1.5 rounded-lg border border-cream-deep text-ink-soft hover:bg-cream-deep/50">Reject</button>
                        <button onClick={() => decide(r.id, 'APPROVED')} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep">Approve</button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={() => setNewOpen(false)}>
          <div className="bg-cream rounded-2xl border border-cream-deep w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between px-5 py-4 border-b border-cream-deep/70">
              <h3 className="font-display text-lg text-ink">New petty cash request</h3>
              <button onClick={() => setNewOpen(false)} className="p-1 rounded hover:bg-cream-deep/60 text-ink-soft"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <FormField label="Staff name">
                <input value={nName} onChange={(e) => setNName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40" />
              </FormField>
              <FormField label="Amount (₹)">
                <input type="number" value={nAmt} onChange={(e) => setNAmt(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40" />
              </FormField>
              <FormField label="Reason">
                <textarea value={nReason} onChange={(e) => setNReason(e.target.value)} rows={3} className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40" />
              </FormField>
            </div>
            <div className="px-5 py-3 border-t border-cream-deep/70 flex items-center justify-end gap-2">
              <button onClick={() => setNewOpen(false)} className="px-3 py-2 text-sm rounded-lg border border-cream-deep text-ink-soft hover:bg-cream-deep/50">Cancel</button>
              <button onClick={addRequest} className="px-4 py-2 text-sm font-medium rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep">Log request</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
