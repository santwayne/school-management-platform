import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api';

// Super Admin → Plans: which school is on Waynur Core (₹400) or Waynur AI (₹650),
// demos, recording payments (billing is manual), upgrades and downgrades.

const INR = (n) => (n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const dateIN = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const todayISO = () => new Date().toISOString().slice(0, 10);

const inputCls = 'w-full rounded-lg border border-cream-deep bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-terracotta/40';
const btn = 'rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50';
const btnPrimary = `${btn} bg-terracotta text-white hover:bg-terracotta-deep`;
const btnGhost = `${btn} border border-cream-deep text-ink hover:bg-cream-deep/40`;

const STATE = {
  demo: { label: 'Demo', cls: 'bg-sky-100 text-sky-800' },
  demo_expired: { label: 'Demo ended', cls: 'bg-destructive/10 text-destructive' },
  paid: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-800' },
  grace: { label: 'Grace period', cls: 'bg-amber-100 text-amber-900' },
  expired: { label: 'Expired', cls: 'bg-destructive/10 text-destructive' },
  none: { label: 'Plan not set', cls: 'bg-cream-deep text-ink-soft' },
  legacy: { label: 'Retired plan', cls: 'bg-violet-100 text-violet-800' },
};
const PLAN_BADGE = {
  core: 'bg-ink/5 text-ink',
  ai: 'bg-terracotta/10 text-terracotta-deep',
};
const ACTION = {
  demo_started: 'Demo started',
  demo_extended: 'Demo extended',
  payment_recorded: 'Payment recorded',
  upgraded: 'Upgraded',
  downgrade_scheduled: 'Downgrade booked',
  downgrade_cancelled: 'Downgrade cancelled',
  downgrade_applied: 'Downgraded',
  expired: 'Expired',
  plan_set: 'Plan set',
};
const METHODS = [
  ['bank', 'Bank transfer'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['cash', 'Cash'],
  ['razorpay_link', 'Razorpay link'], ['comp', 'Complimentary (free)'],
];
const FILTERS = [
  ['all', 'All'], ['core', 'Core'], ['ai', 'AI'], ['demo', 'Demo'], ['expiring', 'Expiring soon'],
  ['expired', 'Expired'], ['none', 'Plan not set'], ['legacy', 'Retired plan'],
];

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-ink-soft">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-xs text-ink-soft mt-1 block">{hint}</span>}
    </label>
  );
}

function Badge({ cls, children }) {
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-xl bg-white border border-cream-deep/70 px-4 py-3">
      <div className={`font-display text-2xl ${tone || 'text-ink'}`}>{value}</div>
      <div className="text-xs text-ink-soft mt-0.5">{label}</div>
    </div>
  );
}

function validity(s) {
  if (s.state === 'demo') return `Demo till ${dateIN(s.demo_ends_at)} (${s.demo_days_left}d)`;
  if (s.state === 'demo_expired') return `Demo ended ${dateIN(s.demo_ends_at)}`;
  if (s.state === 'paid') return `Paid till ${dateIN(s.paid_until)} (${s.paid_days_left}d)`;
  if (s.state === 'grace') return `Ended ${dateIN(s.paid_until)} — in grace`;
  if (s.state === 'expired') return s.paid_until ? `Ended ${dateIN(s.paid_until)}` : 'Ended';
  return '—';
}

// ---------- Plan rates (Core / AI) ----------

function RateCard({ plan, onSaved }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ per: plan.per_student_yearly, min: plan.min_yearly, reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/super-admin/plans/catalog/${plan.code}`, { method: 'PATCH', body: { per_student_yearly: Number(f.per), min_yearly: Number(f.min), reason: f.reason } });
      setEdit(false); onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg text-ink">{plan.name}</div>
          <div className="text-sm text-ink mt-0.5">{INR(plan.per_student_yearly)} per student / year <span className="text-ink-soft">(≈ {INR(plan.per_student_monthly)}/month)</span></div>
          <div className="text-xs text-ink-soft mt-0.5">Minimum {INR(plan.min_yearly)} / year per school · + 18% GST · {plan.includes_ai ? 'All AI features' : 'No AI features'}</div>
        </div>
        {!edit && <button className={btnGhost} onClick={() => setEdit(true)}>Edit</button>}
      </div>
      {edit && (
        <div className="mt-4 grid sm:grid-cols-3 gap-3">
          <Field label="₹ per student / year"><input type="number" min="1" className={inputCls} value={f.per} onChange={(e) => setF({ ...f, per: e.target.value })} /></Field>
          <Field label="Yearly minimum ₹"><input type="number" min="0" className={inputCls} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
          <Field label="Reason"><input className={inputCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. 2027 pricing" /></Field>
          <p className="sm:col-span-3 text-xs text-ink-soft">New rates apply to payments recorded from now on. Schools already paid keep their period.</p>
          {error && <div className="sm:col-span-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="sm:col-span-3 flex gap-2">
            <button className={btnPrimary} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            <button className={btnGhost} onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- One school: actions + history ----------

function PaymentForm({ school, onDone }) {
  const [f, setF] = useState({
    plan: school.plan === 'core' || school.plan === 'ai' ? school.plan : 'core',
    students: String(Math.max(school.students || 0, school.licensed_students || 0) || ''),
    amount: '',
    period_start: todayISO(),
    period_end: '',
    method: 'bank',
    reference: '',
    note: '',
  });
  const [q, setQ] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Live price for the chosen plan + students; the amount is pre-filled from it.
  useEffect(() => {
    if (!f.students) { setQ(null); return; }
    const t = setTimeout(async () => {
      try {
        const res = await apiRequest(`/api/super-admin/plans/quote?plan=${f.plan}&students=${Number(f.students)}&school_id=${school.school_id}`);
        setQ(res);
        setF((cur) => ({ ...cur, amount: String(res.upgrade ? res.upgrade.amount : res.yearly_price) }));
      } catch { setQ(null); }
    }, 300);
    return () => clearTimeout(t);
  }, [f.plan, f.students, school.school_id]);

  const isMidYearUpgrade = !!q?.upgrade;
  const submit = async () => {
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/super-admin/plans/schools/${school.school_id}/payment`, {
        method: 'POST',
        body: {
          plan: f.plan,
          students: Number(f.students),
          amount: f.method === 'comp' ? 0 : Number(f.amount),
          // A mid-year upgrade keeps the current paid-until date.
          period_start: isMidYearUpgrade ? todayISO() : f.period_start,
          period_end: isMidYearUpgrade ? String(q.upgrade.paid_until).slice(0, 10) : (f.period_end || null),
          method: f.method,
          reference: f.reference,
          note: f.note,
        },
      });
      onDone('Payment recorded — plan is active.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-cream-deep bg-cream/40 p-4 space-y-3">
      <div className="font-medium text-ink">Record payment</div>
      <p className="text-xs text-ink-soft">Use this for the first purchase, a yearly renewal, adding students, or a mid-year upgrade to AI. Amounts are before GST.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Plan">
          <select className={inputCls} value={f.plan} onChange={set('plan')}>
            <option value="core">Waynur Core</option>
            <option value="ai">Waynur AI</option>
          </select>
        </Field>
        <Field label="Students paid for" hint={`School has ${school.students} students now`}>
          <input type="number" min="1" className={inputCls} value={f.students} onChange={set('students')} />
        </Field>
      </div>
      {q && (
        <div className="rounded-lg bg-white border border-cream-deep px-3 py-2 text-sm text-ink">
          {isMidYearUpgrade ? (
            <>Mid-year upgrade: <b>{INR(q.upgrade.amount)}</b> + GST {INR(q.upgrade.gst)} = <b>{INR(q.upgrade.total_with_gst)}</b>
              <div className="text-xs text-ink-soft">AI minus Core for the days left, paid period stays till {dateIN(q.upgrade.paid_until)}.</div></>
          ) : (
            <>Yearly price: <b>{INR(q.yearly_price)}</b> + GST {INR(q.gst)} = <b>{INR(q.total_with_gst)}</b>
              {q.minimum_applied && <div className="text-xs text-ink-soft">Yearly minimum applied.</div>}</>
          )}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Method">
          <select className={inputCls} value={f.method} onChange={set('method')}>
            {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Amount received ₹ (before GST)" hint="Pre-filled from the price; change it for a discount.">
          <input type="number" min="0" className={inputCls} value={f.method === 'comp' ? 0 : f.amount} disabled={f.method === 'comp'} onChange={set('amount')} />
        </Field>
        {!isMidYearUpgrade && (
          <>
            <Field label="Period start"><input type="date" className={inputCls} value={f.period_start} onChange={set('period_start')} /></Field>
            <Field label="Period end" hint="Empty = one year from start"><input type="date" className={inputCls} value={f.period_end} onChange={set('period_end')} /></Field>
          </>
        )}
        <Field label="Reference"><input className={inputCls} value={f.reference} onChange={set('reference')} placeholder="UTR / cheque no." /></Field>
        <Field label="Note"><input className={inputCls} value={f.note} onChange={set('note')} /></Field>
      </div>
      {error && <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <button className={btnPrimary} disabled={busy || !f.students} onClick={submit}>{busy ? 'Saving…' : 'Record payment'}</button>
    </div>
  );
}

function SchoolPanel({ schoolId, onClose, onChanged }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState('14');
  const [showPay, setShowPay] = useState(false);

  const load = async () => {
    try { setS(await apiRequest(`/api/super-admin/plans/schools/${schoolId}`)); setError(''); } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, [schoolId]);

  const act = async (path, body, okMsg) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await apiRequest(`/api/super-admin/plans/schools/${schoolId}/${path}`, { method: 'POST', body });
      setNotice(typeof okMsg === 'function' ? okMsg(res) : okMsg);
      setShowPay(false);
      await load(); onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const paid = s && ['paid', 'grace'].includes(s.state);
  const inDemo = s && ['demo', 'demo_expired'].includes(s.state);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="fixed inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full overflow-y-auto bg-cream p-6 shadow-xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-display text-2xl text-ink">{s?.school_name || 'Loading…'}</div>
            {s && (
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <Badge cls={PLAN_BADGE[s.plan] || 'bg-violet-100 text-violet-800'}>{s.plan_name}</Badge>
                <Badge cls={STATE[s.state]?.cls}>{STATE[s.state]?.label}</Badge>
                <span className="text-xs text-ink-soft">AI features {s.ai_enabled ? 'ON' : 'OFF'}</span>
              </div>
            )}
          </div>
          <button className={btnGhost} onClick={onClose}>Close</button>
        </div>

        {error && <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        {notice && <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-900">{notice}</div>}

        {s && (
          <>
            <div className="rounded-xl bg-white border border-cream-deep/70 p-4 grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-xs text-ink-soft">Validity</div><div className="text-ink">{validity(s)}</div></div>
              <div><div className="text-xs text-ink-soft">Students</div><div className={s.over_licence ? 'text-destructive font-medium' : 'text-ink'}>{s.students}{s.licensed_students != null ? ` / ${s.licensed_students} paid` : ''}</div></div>
              <div><div className="text-xs text-ink-soft">Yearly value</div><div className="text-ink">{INR(s.yearly_value)}</div></div>
              <div><div className="text-xs text-ink-soft">Booked change</div><div className="text-ink">{s.pending_plan_code ? `→ ${s.pending_plan_code.toUpperCase()} after ${dateIN(s.paid_until)}` : '—'}</div></div>
            </div>
            {s.over_licence && <p className="text-xs text-destructive">School has more students than paid for — record a payment for the extra students.</p>}

            {/* Demo */}
            {!paid && (
              <div className="rounded-xl bg-white border border-cream-deep/70 p-4 space-y-2">
                <div className="font-medium text-ink">{inDemo ? 'Extend demo' : 'Give a demo'}</div>
                <p className="text-xs text-ink-soft">Demo = full Waynur AI plan, free. When it ends the school becomes read-only until a payment is recorded.</p>
                <div className="flex items-center gap-2">
                  <input type="number" min="1" max="90" className={`${inputCls} w-24`} value={days} onChange={(e) => setDays(e.target.value)} />
                  <span className="text-sm text-ink-soft">days</span>
                  <button className={btnPrimary} disabled={busy} onClick={() => act(inDemo ? 'demo/extend' : 'demo', { days: Number(days) }, inDemo ? `Demo extended by ${days} days.` : `${days}-day AI demo started.`)}>
                    {inDemo ? 'Extend' : 'Start demo'}
                  </button>
                </div>
              </div>
            )}

            {/* Upgrade / downgrade */}
            <div className="rounded-xl bg-white border border-cream-deep/70 p-4 space-y-2">
              <div className="font-medium text-ink">Change plan</div>
              {s.pending_plan_code ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink">Downgrade to {s.pending_plan_code.toUpperCase()} booked for {dateIN(s.paid_until)}.</span>
                  <button className={btnGhost} disabled={busy} onClick={() => act('cancel-downgrade', {}, 'Booked downgrade cancelled.')}>Cancel downgrade</button>
                </div>
              ) : s.plan === 'core' ? (
                <>
                  <p className="text-xs text-ink-soft">
                    {paid ? 'For a paid school, record the upgrade payment below (the price shown is the difference for the days left). Use "Upgrade now" only for a free/agreed upgrade.' : 'Switches AI features on now.'}
                  </p>
                  <button className={btnGhost} disabled={busy} onClick={() => act('change', { to_plan: 'ai' }, 'Upgraded to Waynur AI.')}>Upgrade to AI now</button>
                </>
              ) : s.plan === 'ai' ? (
                <>
                  <p className="text-xs text-ink-soft">{s.state === 'paid' ? `AI stays on till ${dateIN(s.paid_until)}; the school renews on Core.` : 'Switches AI features off now.'}</p>
                  <button className={btnGhost} disabled={busy} onClick={() => act('change', { to_plan: 'core' }, (r) => (r.applied === 'at_period_end' ? `Downgrade booked for ${dateIN(r.effective_on)}.` : 'Moved to Waynur Core.'))}>
                    Downgrade to Core
                  </button>
                </>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <p className="w-full text-xs text-ink-soft">On a retired plan. Move to Core or AI, then record their payment.</p>
                  <button className={btnGhost} disabled={busy} onClick={() => act('change', { to_plan: 'core' }, 'Moved to Waynur Core.')}>Move to Core</button>
                  <button className={btnGhost} disabled={busy} onClick={() => act('change', { to_plan: 'ai' }, 'Moved to Waynur AI.')}>Move to AI</button>
                </div>
              )}
            </div>

            {/* Payment */}
            {showPay ? (
              <PaymentForm school={s} onDone={(msg) => { setShowPay(false); setNotice(msg); load(); onChanged(); }} />
            ) : (
              <button className={btnPrimary} onClick={() => setShowPay(true)}>Record payment / renewal</button>
            )}

            {/* History */}
            <div className="rounded-xl bg-white border border-cream-deep/70 p-4">
              <div className="font-medium text-ink mb-2">History</div>
              {s.history.length === 0 ? <p className="text-sm text-ink-soft">Nothing yet.</p> : (
                <ul className="space-y-2">
                  {s.history.map((h) => (
                    <li key={h.id} className="text-sm border-b border-cream-deep/50 pb-2">
                      <div className="flex justify-between gap-2">
                        <span className="text-ink font-medium">{ACTION[h.action] || h.action}{h.to_plan ? ` · ${h.to_plan.toUpperCase()}` : ''}</span>
                        <span className="text-xs text-ink-soft">{dateIN(h.created_at)}</span>
                      </div>
                      <div className="text-xs text-ink-soft">
                        {[h.amount != null && `${INR(h.amount)} + GST ${INR(h.gst)}`, h.students && `${h.students} students`,
                          h.period_end && `till ${dateIN(h.period_end)}`, h.method, h.reference, h.note, h.actor_email || (h.actor_id ? null : 'system')]
                          .filter(Boolean).join(' · ')}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Page ----------

export default function SuperAdminPlans() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);

  const load = async () => {
    try { setData(await apiRequest('/api/super-admin/plans')); setError(''); } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.schools.filter((s) => {
      if (q && !s.school_name.toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'core': return s.plan === 'core' && !['legacy'].includes(s.state);
        case 'ai': return s.plan === 'ai' && !['legacy'].includes(s.state);
        case 'demo': return ['demo', 'demo_expired'].includes(s.state);
        case 'expiring': return (s.state === 'demo' && s.demo_days_left <= 7) || (s.state === 'paid' && s.paid_days_left <= 30) || s.state === 'grace';
        case 'expired': return ['expired', 'demo_expired'].includes(s.state);
        case 'none': return s.state === 'none';
        case 'legacy': return s.state === 'legacy';
        default: return true;
      }
    });
  }, [data, filter, search]);

  if (!data && !error) return <p className="text-sm text-ink-soft">Loading…</p>;

  const m = data?.summary;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-ink">Plans</h1>
        <p className="text-sm text-ink-soft mt-1">Which school is on Waynur Core or Waynur AI, demos, payments, upgrades and downgrades. Billing is manual — record each payment here.</p>
      </div>
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      {m && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label={`Core paid · ${m.students_core} students`} value={m.core_paid} />
          <Stat label={`AI paid · ${m.students_ai} students`} value={m.ai_paid} tone="text-terracotta-deep" />
          <Stat label={`Demos (${m.demo_ending_7d} ending in 7 days)`} value={m.demo_active} />
          <Stat label="Yearly value (paid schools)" value={INR(m.yearly_value_paid)} />
          <Stat label="Renewals due in 30 days" value={m.renewals_due_30d} tone={m.renewals_due_30d ? 'text-amber-700' : undefined} />
          <Stat label="Expired (read-only)" value={m.expired} tone={m.expired ? 'text-destructive' : undefined} />
          <Stat label="Plan not set" value={m.plan_not_set} />
          <Stat label="On retired plans" value={m.on_retired_plan} />
        </div>
      )}

      {data && (
        <div className="grid md:grid-cols-2 gap-4">
          {data.plans.map((p) => <RateCard key={p.code} plan={p} onSaved={load} />)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-sm ${filter === k ? 'bg-ink text-white' : 'border border-cream-deep text-ink-soft hover:bg-cream-deep/40'}`}>{l}</button>
        ))}
        <input className={`${inputCls} sm:w-56 sm:ml-auto`} placeholder="Search school" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-soft border-b border-cream-deep">
              <th className="py-3 px-4 font-normal">School</th>
              <th className="font-normal">Plan</th>
              <th className="font-normal">Status</th>
              <th className="font-normal">Students</th>
              <th className="font-normal">Validity</th>
              <th className="font-normal">AI</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-ink-soft">No schools here.</td></tr>}
            {rows.map((s) => (
              <tr key={s.school_id} className="border-b border-cream-deep/50">
                <td className="py-3 px-4 text-ink">{s.school_name}{s.school_status === 'suspended' && <span className="ml-2 text-xs text-destructive">suspended</span>}</td>
                <td><Badge cls={PLAN_BADGE[s.plan] || 'bg-violet-100 text-violet-800'}>{s.plan_name}</Badge>{s.pending_plan_code && <div className="text-xs text-amber-700 mt-0.5">→ {s.pending_plan_code.toUpperCase()} at renewal</div>}</td>
                <td><Badge cls={STATE[s.state]?.cls}>{STATE[s.state]?.label}</Badge></td>
                <td className={s.over_licence ? 'text-destructive' : 'text-ink'}>{s.students}{s.licensed_students != null ? ` / ${s.licensed_students}` : ''}</td>
                <td className="text-ink-soft">{validity(s)}</td>
                <td>{s.ai_enabled ? 'On' : 'Off'}</td>
                <td className="pr-4 text-right"><button className={btnGhost} onClick={() => setOpen(s.school_id)}>Manage</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && <SchoolPanel schoolId={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}
