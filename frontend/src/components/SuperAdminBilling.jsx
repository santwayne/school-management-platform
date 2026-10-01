import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';

const INR = (n) => {
  const v = Number(n || 0);
  const frac = Number.isInteger(v) ? 0 : 2;
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: frac, maximumFractionDigits: frac });
};
const dt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

const SOURCE_BADGE = {
  database: { label: 'Saved in Waynur', cls: 'bg-emerald-100 text-emerald-800' },
  env: { label: 'From server .env', cls: 'bg-amber-100 text-amber-800' },
  missing: { label: 'Not set — monthly checkout off', cls: 'bg-destructive/10 text-destructive' },
};

const ACTION_LABEL = {
  plan_updated: 'Plan edited',
  razorpay_plan_created: 'Razorpay plan created',
  razorpay_plan_linked: 'Razorpay plan linked',
  razorpay_plan_cleared: 'Razorpay plan ID cleared',
};

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-ink-soft">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-xs text-ink-soft mt-1 block">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-cream-deep bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-terracotta/40';
const btn = 'rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50';
const btnPrimary = `${btn} bg-terracotta text-white hover:bg-terracotta-deep`;
const btnGhost = `${btn} border border-cream-deep text-ink hover:bg-cream-deep/40`;

function PlanEditor({ plan, onSaved, onCancel }) {
  const [f, setF] = useState({
    name: plan.name,
    price: plan.price,
    yearly_price: plan.yearly_price ?? '',
    student_limit: plan.unlimited_students ? '' : plan.student_limit,
    unlimited_students: plan.unlimited_students,
    apply_to_existing: true,
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const priceChanged = Number(f.price) !== plan.price;
  const limitsChanged = (f.unlimited_students !== plan.unlimited_students)
    || (!f.unlimited_students && Number(f.student_limit) !== plan.student_limit);

  const save = async () => {
    setBusy(true); setError('');
    try {
      const res = await apiRequest(`/api/billing/admin/plans/${plan.code}`, {
        method: 'PATCH',
        body: {
          name: f.name,
          price: Number(f.price),
          yearly_price: f.yearly_price === '' ? null : Number(f.yearly_price),
          student_limit: f.unlimited_students ? 999999 : Number(f.student_limit),
          unlimited_students: f.unlimited_students,
          apply_to_existing: f.apply_to_existing,
          reason: f.reason,
        },
      });
      onSaved(res, res.unchanged ? 'Nothing changed.' : [
        `${plan.name} updated.`,
        res.new_razorpay_plan_id ? ` New Razorpay plan ${res.new_razorpay_plan_id} created for the new price.` : '',
        res.schools_updated ? ` Limits applied to ${res.schools_updated} school(s).` : '',
      ].join(''));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-cream-deep bg-cream/40 p-4 space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Plan name"><input className={inputCls} value={f.name} onChange={set('name')} /></Field>
        <Field label="Monthly price (₹, before GST)" hint={`Schools pay ${INR(Math.round(Number(f.price || 0) * 118) / 100)} incl. 18% GST`}>
          <input type="number" min="1" step="0.01" className={inputCls} value={f.price} onChange={set('price')} />
        </Field>
        <Field label="Yearly price (₹, before GST)" hint="Leave empty to switch yearly billing off for this plan">
          <input type="number" min="1" step="0.01" className={inputCls} value={f.yearly_price} onChange={set('yearly_price')} />
        </Field>
        <Field label="Student limit">
          <div className="flex items-center gap-3">
            <input type="number" min="1" className={inputCls} value={f.student_limit} onChange={set('student_limit')} disabled={f.unlimited_students} />
            <label className="flex items-center gap-2 text-sm text-ink whitespace-nowrap">
              <input type="checkbox" checked={f.unlimited_students} onChange={set('unlimited_students')} /> Unlimited
            </label>
          </div>
        </Field>
        <Field label="Reason (saved in change history)">
          <input className={inputCls} value={f.reason} onChange={set('reason')} placeholder="e.g. Diwali price revision" />
        </Field>
      </div>

      {limitsChanged && (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className="mt-0.5" checked={f.apply_to_existing} onChange={set('apply_to_existing')} />
          <span>Also apply the new student limit to the {plan.schools_on_plan} school(s) already on {plan.name}</span>
        </label>
      )}
      {priceChanged && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
          Razorpay plans can't change price, so saving creates a <b>new Razorpay plan</b> at {INR(Math.round(Number(f.price || 0) * 118) / 100)}/month
          and new checkouts use it. Schools already subscribed monthly keep paying the old amount until they change plan.
        </div>
      )}
      {error && <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="flex gap-2">
        <button className={btnPrimary} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button className={btnGhost} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function LinkIdForm({ plan, onSaved, onCancel }) {
  const [id, setId] = useState(plan.db_plan_id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (value) => {
    setBusy(true); setError('');
    try {
      const res = await apiRequest(`/api/billing/admin/plans/${plan.code}/razorpay-id`, { method: 'PUT', body: { razorpay_plan_id: value } });
      onSaved(res, value ? `${plan.name} linked to ${value} (checked with Razorpay).` : `${plan.name}: saved ID cleared${plan.env_plan_id ? ', using the .env value again' : ''}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 rounded-xl border border-cream-deep bg-cream/40 p-4 space-y-3">
      <Field label="Razorpay plan ID" hint={`Must be a monthly plan for exactly ${INR(plan.price_with_gst)} in the same mode (test/live) as the server keys.`}>
        <input className={`${inputCls} font-mono`} value={id} onChange={(e) => setId(e.target.value.trim())} placeholder="plan_XXXXXXXXXXXX" />
      </Field>
      {error && <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} onClick={() => save(id)} disabled={busy || !id}>{busy ? 'Checking…' : 'Verify & save'}</button>
        {plan.db_plan_id && <button className={btnGhost} onClick={() => save('')} disabled={busy}>Clear saved ID</button>}
        <button className={btnGhost} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function PlanCard({ plan, mode, onChange, notify }) {
  const [panel, setPanel] = useState(null); // 'edit' | 'link' | null
  const [busy, setBusy] = useState(false);
  const badge = SOURCE_BADGE[plan.razorpay_plan_source];

  const createInRazorpay = async () => {
    if (plan.razorpay_plan_id && !window.confirm(`${plan.name} already has ${plan.razorpay_plan_id}. Create a new Razorpay plan and switch to it?`)) return;
    setBusy(true);
    try {
      const res = await apiRequest(`/api/billing/admin/plans/${plan.code}/razorpay`, { method: 'POST' });
      onChange(res.plans);
      notify(`Created ${res.razorpay_plan_id} in Razorpay (${mode} mode) for ${plan.name}.`);
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  };
  const saved = (res, msg) => { onChange(res.plans); setPanel(null); notify(msg); };

  return (
    <div className="rounded-xl border border-cream-deep/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-xl text-ink">{plan.name}</div>
          <div className="text-xs text-ink-soft mt-0.5">{plan.schools_on_plan} school{plan.schools_on_plan === 1 ? '' : 's'} on this plan</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btnGhost} onClick={() => setPanel(panel === 'edit' ? null : 'edit')}>Edit plan</button>
          <button className={btnGhost} onClick={() => setPanel(panel === 'link' ? null : 'link')}>Link plan ID</button>
          <button className={btnPrimary} onClick={createInRazorpay} disabled={busy || mode === 'none'}>
            {busy ? 'Creating…' : plan.razorpay_plan_id ? 'Re-create in Razorpay' : 'Create in Razorpay'}
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-4 mt-4 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-soft">Monthly</div>
          <div className="text-ink">{INR(plan.price)} <span className="text-ink-soft">+ GST = {INR(plan.price_with_gst)}</span></div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-soft">Yearly</div>
          <div className="text-ink">{plan.yearly_price ? <>{INR(plan.yearly_price)} <span className="text-ink-soft">+ GST = {INR(plan.yearly_price_with_gst)}</span></> : <span className="text-ink-soft">Off</span>}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-soft">Limits</div>
          <div className="text-ink">{plan.unlimited_students ? 'Unlimited' : plan.student_limit} students · unlimited accountants</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-soft">Razorpay monthly plan</div>
          <div className="font-mono text-xs text-ink break-all">{plan.razorpay_plan_id || '—'}</div>
          <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
        </div>
      </div>

      {panel === 'edit' && <PlanEditor plan={plan} onSaved={saved} onCancel={() => setPanel(null)} />}
      {panel === 'link' && <LinkIdForm plan={plan} onSaved={saved} onCancel={() => setPanel(null)} />}
    </div>
  );
}

export default function SuperAdminBilling() {
  const [schools, setSchools] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadCatalog = () => apiRequest('/api/billing/admin/plans').then(setCatalog);

  useEffect(() => {
    Promise.all([apiRequest('/api/super-admin/schools').then(setSchools), loadCatalog()])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const notify = (text, isError = false) => setNotice({ text, isError });
  const onPlansChange = (plans) => { setCatalog((c) => ({ ...c, plans })); loadCatalog().catch(() => {}); };

  const plans = catalog?.plans || [];
  const priceOf = Object.fromEntries(plans.map((p) => [p.code, p.price]));
  const activeSchools = schools.filter((s) => s.status === 'active');
  const byPlan = plans.map((p) => {
    const list = activeSchools.filter((s) => (s.plan || 'starter') === p.code);
    return { plan: p.name, count: list.length, mrr: list.length * (priceOf[p.code] || 0) };
  });
  const totalMRR = byPlan.reduce((a, p) => a + p.mrr, 0);
  const pastDue = activeSchools.filter((s) => s.billing_status === 'past_due');
  const subscribedCount = activeSchools.filter((s) => s.razorpay_subscription_id).length;
  const mode = catalog?.mode || 'none';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-ink">Subscriptions & Billing</h1>
        <p className="text-sm text-ink-soft mt-1">What Wayne E Solutions bills each school for Waynur.</p>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {notice && (
        <div className={`rounded-xl px-4 py-3 text-sm flex justify-between gap-4 ${notice.isError ? 'bg-destructive/10 border border-destructive/20 text-destructive' : 'bg-emerald-50 border border-emerald-200 text-emerald-900'}`}>
          <span>{notice.text}</span>
          <button className="text-xs underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      {loading && <p className="text-sm text-ink-soft">Loading…</p>}

      {!loading && (
        <>
          {pastDue.length > 0 && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              <span className="font-medium">{pastDue.length} school{pastDue.length > 1 ? 's have' : ' has'} a past-due Razorpay subscription:</span>{' '}
              {pastDue.map((s) => s.name).join(', ')}.
            </div>
          )}

          <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
              <h2 className="font-display text-xl text-ink">Plans & pricing</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${mode === 'live' ? 'bg-emerald-100 text-emerald-800' : mode === 'test' ? 'bg-amber-100 text-amber-800' : 'bg-destructive/10 text-destructive'}`}>
                Razorpay: {mode === 'live' ? 'LIVE keys' : mode === 'test' ? 'TEST keys' : mode === 'none' ? 'no keys on server' : 'unknown keys'}
              </span>
            </div>
            <p className="text-sm text-ink-soft mb-4">
              Prices are before GST; schools are charged price + 18%. Monthly billing needs a Razorpay plan per tier —
              use <b>Create in Razorpay</b>, or <b>Link plan ID</b> for one made in the Razorpay dashboard. A saved ID
              overrides <code>RAZORPAY_PLAN_ID_*</code> in the server .env. Test and live plans are separate: after
              switching to live keys, create (or link) the plans again.
            </p>
            <div className="space-y-4">
              {plans.map((p) => <PlanCard key={p.code} plan={p} mode={mode} onChange={onPlansChange} notify={notify} />)}
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
            <div className="text-xs uppercase tracking-wider text-ink-soft">Estimated MRR</div>
            <div className="font-display text-3xl text-ink mt-1">{INR(totalMRR)}</div>
            <p className="text-xs text-ink-soft mt-2">
              Active schools × their plan's current list price (before GST). {subscribedCount} of {activeSchools.length} active
              school{activeSchools.length === 1 ? '' : 's'} pay through a Razorpay subscription; the rest are on a manually-set plan.
            </p>
            <div className="grid sm:grid-cols-3 gap-4 mt-4">
              {byPlan.map((p) => (
                <div key={p.plan} className="rounded-xl bg-cream-deep/30 p-4">
                  <div className="text-xs uppercase tracking-wider text-ink-soft">{p.plan}</div>
                  <div className="font-display text-xl text-ink mt-1">{p.count} school{p.count !== 1 ? 's' : ''}</div>
                  <div className="text-xs text-ink-soft mt-0.5">{INR(p.mrr)}/mo</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
            <h2 className="font-display text-xl text-ink mb-3">Plan change history</h2>
            {!catalog?.history?.length && <p className="text-sm text-ink-soft">No changes yet.</p>}
            <ul className="divide-y divide-cream-deep/50">
              {(catalog?.history || []).map((h) => (
                <li key={h.id} className="py-2.5 text-sm flex flex-wrap justify-between gap-2">
                  <span className="text-ink">
                    <b className="capitalize">{h.plan_code}</b> · {ACTION_LABEL[h.action] || h.action}
                    {(h.detail?.razorpay_plan_id || h.detail?.after?.razorpay_plan_id) && <span className="font-mono text-xs text-ink-soft"> {h.detail.razorpay_plan_id || h.detail.after.razorpay_plan_id}</span>}
                    {h.detail?.reason && <span className="text-ink-soft"> — {h.detail.reason}</span>}
                    {h.detail?.mode && <span className="text-xs text-ink-soft"> ({h.detail.mode})</span>}
                  </span>
                  <span className="text-xs text-ink-soft">{dt(h.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
