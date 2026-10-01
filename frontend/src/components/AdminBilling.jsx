import React, { useEffect, useRef, useState } from 'react';
import { apiRequest, apiDownload } from '../api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';

const INR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const P = (paise) => INR(Number(paise || 0) / 100);
const dateIN = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// Load Razorpay Checkout once and share the promise, so the billing page can
// warm it up on mount and the "Subscribe" click never waits on the script.
let razorpayPromise = null;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(true);
  if (razorpayPromise) return razorpayPromise;
  razorpayPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => { razorpayPromise = null; s.remove(); resolve(false); };
    document.body.appendChild(s);
  });
  return razorpayPromise;
}

function UsageRow({ label, used, limit }) {
  const unlimited = limit === 999999;
  const pct = limit && !unlimited ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const near = pct >= 90;
  return (
    <div className="py-2.5">
      <div className="flex justify-between text-sm text-ink mb-1">
        <span>{label}</span>
        <span className={near ? 'text-destructive font-medium' : 'text-ink-soft'}>
          {used}{limit !== null && limit !== undefined ? ` / ${unlimited ? 'Unlimited' : limit}` : ''}
        </span>
      </div>
      {!!limit && !unlimited && (
        <div className="h-2 rounded-full bg-cream-deep overflow-hidden">
          <div className={`h-full ${near ? 'bg-destructive' : 'bg-terracotta'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function Row({ k, v, strong, muted }) {
  return (
    <div className={`flex justify-between py-1 text-sm ${strong ? 'font-semibold text-ink border-t border-cream-deep mt-1 pt-2' : muted ? 'text-ink-soft' : 'text-ink'}`}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}

// Price + 18% GST + proration, then Razorpay Checkout, then "Activating…"
// until the webhook has actually applied the plan.
function CheckoutModal({ open, onClose, planCode, cycle, onDone }) {
  const [quote, setQuote] = useState(null);
  const [phase, setPhase] = useState('quote'); // quote | paying | activating | done | error
  // Our dialog is a Radix modal: while open it sets pointer-events:none on
  // <body> and traps focus, which froze the Razorpay window (nothing clickable
  // or typable). So the dialog hides while Razorpay is open and comes back
  // afterwards (Activating… / error / closed).
  const [rzpOpen, setRzpOpen] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setQuote(null); setError(''); setPhase('quote');
    apiRequest(`/api/billing/quote?plan=${planCode}&cycle=${cycle}`)
      .then(setQuote)
      .catch((e) => { setError(e.message); setPhase('error'); });
    return () => clearInterval(pollRef.current);
  }, [open, planCode, cycle]);

  const poll = (rowId) => {
    setPhase('activating');
    const started = Date.now();
    pollRef.current = setInterval(async () => {
      try {
        const s = await apiRequest(`/api/billing/checkout/${rowId}/status`);
        if (s.status === 'done') { clearInterval(pollRef.current); setPhase('done'); onDone(); }
        else if (Date.now() - started > 120000) {
          clearInterval(pollRef.current);
          setError('Payment received by Razorpay, but activation is taking longer than usual. It will apply automatically — refresh in a few minutes.');
          setPhase('error');
        }
      } catch { /* keep polling */ }
    }, 3000);
  };

  const pay = async () => {
    setError(''); setPhase('paying');
    try {
      // Script load and checkout creation run in parallel instead of back-to-back.
      const [ok, res] = await Promise.all([
        loadRazorpay(),
        apiRequest('/api/billing/checkout', { method: 'POST', body: { plan: planCode, cycle } }),
      ]);
      if (!ok) throw new Error('Could not load Razorpay. Check your connection and try again.');
      const rzp = new window.Razorpay({
        ...res.checkout,
        theme: { color: '#B5532F' },
        handler: async (resp) => {
          setRzpOpen(false);
          try { await apiRequest('/api/billing/checkout/confirm', { method: 'POST', body: resp }); } catch { /* webhook is authoritative */ }
          poll(res.subscription_row_id);
        },
        modal: { ondismiss: () => { setRzpOpen(false); setPhase((p) => (p === 'paying' ? 'quote' : p)); } },
      });
      // Razorpay keeps its window open for a retry after a failure; just
      // remember the reason so it shows once the window is closed.
      rzp.on('payment.failed', (r) => setError(r?.error?.description || 'Payment failed'));
      setRzpOpen(true);
      // Let the dialog finish closing (releases the body lock + focus trap) first.
      await new Promise((r) => setTimeout(r, 300));
      rzp.open();
    } catch (e) {
      setRzpOpen(false); setError(e.message); setPhase('quote');
    }
  };

  const applies = quote?.applies === 'next_cycle'
    ? `Switches on ${dateIN(quote.new_term_starts_at)} (your current plan stays until then).`
    : quote?.kind === 'upgrade' ? 'Upgrade applies immediately after payment.' : 'Activates as soon as payment is confirmed.';

  return (
    <Dialog open={open && !rzpOpen} onOpenChange={(o) => { if (!o && phase !== 'activating' && phase !== 'paying') onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{quote ? `${quote.kind === 'downgrade' ? 'Move to' : quote.kind === 'upgrade' ? 'Upgrade to' : 'Subscribe to'} ${quote.plan.name}` : 'Checkout'}</DialogTitle>
          <DialogDescription>{cycle === 'yearly' ? 'Billed once a year' : 'Billed monthly by auto-debit'}</DialogDescription>
        </DialogHeader>

        {phase === 'activating' && (
          <div className="py-8 text-center">
            <div className="mx-auto h-8 w-8 rounded-full border-2 border-terracotta border-t-transparent animate-spin" />
            <p className="mt-4 text-sm text-ink">Activating your plan…</p>
            <p className="text-xs text-ink-soft mt-1">Waiting for Razorpay to confirm. Don't close this window.</p>
          </div>
        )}
        {phase === 'done' && (
          <div className="py-8 text-center">
            <p className="text-ink font-medium">{quote?.kind === 'downgrade' ? 'Plan change booked.' : 'You’re on ' + quote?.plan.name + '.'}</p>
            <p className="text-xs text-ink-soft mt-1">A GST invoice is under Invoices below.</p>
          </div>
        )}

        {(phase === 'quote' || phase === 'paying' || phase === 'error') && (
          <>
            {!quote && !error && <p className="text-sm text-ink-soft py-6">Calculating…</p>}
            {quote && (
              <div className="py-2">
                <Row k={`${quote.plan.name} (${cycle})`} v={P(quote.list_price_paise)} />
                <Row k="GST @ 18%" v={P(quote.gst_paise)} muted />
                <Row k={`Total per ${cycle === 'yearly' ? 'year' : 'month'}`} v={P(quote.recurring_total_paise)} />
                {quote.proration_total_paise > 0 && (
                  <Row k="Prorated difference for the rest of this cycle (incl. GST)" v={P(quote.proration_total_paise)} muted />
                )}
                <Row k="Pay now" v={P(quote.due_now_paise)} strong />
                <p className="text-xs text-ink-soft mt-3">{applies}</p>
                {quote.afa_each_debit && (
                  <p className="text-xs mt-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-900 px-3 py-2">
                    Monthly debits above ₹15,000 need your OTP every month (RBI e-mandate rule). Yearly billing avoids this.
                  </p>
                )}
              </div>
            )}
            {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">{error}</div>}
            <DialogFooter>
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-cream-deep text-sm">Cancel</button>
              {quote && (
                <button onClick={pay} disabled={phase === 'paying'} className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium disabled:opacity-50">
                  {phase === 'paying' ? 'Opening Razorpay…' : quote.due_now_paise > 0 ? `Pay ${P(quote.due_now_paise)}` : 'Authorize & book change'}
                </button>
              )}
            </DialogFooter>
          </>
        )}
        {phase === 'done' && (
          <DialogFooter><button onClick={onClose} className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm">Close</button></DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GstDetails({ details, onSaved }) {
  const [f, setF] = useState({ gstin: details.gstin || '', legal_name: details.legal_name || '', address: details.address || '', state_code: details.state_code || '' });
  const [msg, setMsg] = useState('');
  const save = async () => {
    setMsg('');
    try {
      await apiRequest('/api/billing/details', { method: 'PUT', body: { ...f, gstin: f.gstin.trim().toUpperCase() || null } });
      setMsg('Saved'); onSaved();
    } catch (e) { setMsg(e.message); }
  };
  const input = 'w-full rounded-lg border border-cream-deep px-3 py-2 text-sm bg-white';
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <input className={input} placeholder="GSTIN (optional)" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} />
      <input className={input} placeholder="Legal name on invoice" value={f.legal_name} onChange={(e) => setF({ ...f, legal_name: e.target.value })} />
      <input className={`${input} md:col-span-2`} placeholder="Billing address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      <input className={input} placeholder="State code (e.g. 03 for Punjab)" value={f.state_code} onChange={(e) => setF({ ...f, state_code: e.target.value })} />
      <div className="flex items-center gap-3">
        <button onClick={save} className="px-4 py-2 rounded-lg bg-ink text-white text-sm">Save details</button>
        {msg && <span className="text-xs text-ink-soft">{msg}</span>}
      </div>
    </div>
  );
}

export default function AdminBilling() {
  const [data, setData] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [error, setError] = useState('');
  const [cycle, setCycle] = useState('monthly');
  const [checkout, setCheckout] = useState(null);

  const load = async () => {
    try {
      const [b, inv] = await Promise.all([apiRequest('/api/billing'), apiRequest('/api/billing/invoices').catch(() => [])]);
      setData(b); setInvoices(inv); setError('');
    } catch (err) { setError(err.message); }
  };
  useEffect(() => { load(); loadRazorpay(); }, []);

  const cancel = async () => {
    if (!window.confirm('Cancel auto-renewal? You keep full access until the end of the current billing period.')) return;
    try { await apiRequest('/api/billing/cancel', { method: 'POST' }); await load(); } catch (e) { setError(e.message); }
  };

  if (!data && !error) return <p className="text-sm text-ink-soft">Loading…</p>;
  if (!data) return <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>;

  const plans = Object.entries(data.all_plans).sort((a, b) => a[1].rank - b[1].rank);
  const currentRank = data.all_plans[data.plan]?.rank || 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-ink">Billing</h1>
        <p className="text-sm text-ink-soft mt-1">Your Waynur plan, usage and invoices. Prices exclude 18% GST.</p>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="grid md:grid-cols-[1.2fr_1fr] gap-4">
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
          <div className="font-display text-2xl text-ink">{data.plan_name}</div>
          <div className="text-sm text-ink-soft mt-1">
            {INR(data.price)}/month + GST ({INR(data.price_with_gst)})
            {data.subscription && <> · {data.subscription.billing_cycle} · {data.subscription.cancel_at_period_end ? 'ends' : 'renews'} {dateIN(data.renews_at)}</>}
          </div>
          {data.pending_plan && (
            <p className="text-sm text-ink mt-3">Switching to {data.all_plans[data.pending_plan]?.name} on {dateIN(data.renews_at)}.</p>
          )}
          {data.awaiting_payment && !data.subscription && (
            <p className="text-sm text-amber-800 mt-3">A checkout for {data.all_plans[data.awaiting_payment.plan_code]?.name} was started but not paid yet.</p>
          )}
          {data.can_manage && data.subscription && !data.subscription.cancel_at_period_end && (
            <button onClick={cancel} className="mt-4 text-xs text-ink-soft underline underline-offset-2">Cancel auto-renewal</button>
          )}
        </div>
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
          <h2 className="font-display text-lg text-ink mb-1">Usage</h2>
          <UsageRow label="Students" used={data.usage.students.used} limit={data.usage.students.limit} />
          <UsageRow label="Staff" used={data.usage.staff.used} limit={data.usage.staff.limit} />
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-xl text-ink">Plans</h2>
        <div className="inline-flex rounded-lg border border-cream-deep p-0.5 text-sm">
          {['monthly', 'yearly'].map((c) => (
            <button key={c} onClick={() => setCycle(c)} className={`px-3 py-1.5 rounded-md capitalize ${cycle === c ? 'bg-ink text-white' : 'text-ink-soft'}`}>{c}</button>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {plans.map(([key, p]) => {
          const isCurrent = key === data.plan && data.subscription?.billing_cycle === cycle;
          const available = cycle === 'yearly' ? p.yearly_online : p.monthly_online;
          const verb = !data.subscription ? 'Subscribe' : p.rank > currentRank ? 'Upgrade' : p.rank < currentRank ? 'Downgrade' : 'Switch';
          const price = cycle === 'yearly' ? p.yearly_price : p.price;
          return (
            <div key={key} className={`rounded-2xl border p-5 flex flex-col ${key === data.plan ? 'border-terracotta bg-terracotta/5' : 'border-cream-deep/70 bg-white'}`}>
              <div className="font-display text-lg text-ink">{p.name}</div>
              <div className="text-sm text-ink mt-0.5">{price ? `${INR(price)}/${cycle === 'yearly' ? 'year' : 'month'}` : '—'}</div>
              <div className="text-xs text-ink-soft">+18% GST{price ? ` = ${INR(Math.round(price * 118) / 100)}` : ''}</div>
              <ul className="text-xs text-ink-soft mt-3 space-y-1 flex-1">
                <li>{p.student_limit === 999999 ? 'Unlimited students' : `Up to ${p.student_limit} students`}</li>
                <li>Unlimited accountant logins</li>
              </ul>
              {isCurrent ? (
                <span className="mt-4 text-center text-xs font-medium py-2 rounded-lg bg-terracotta/10 text-terracotta">Current plan</span>
              ) : !data.can_manage ? (
                <span className="mt-4 text-center text-xs text-ink-soft py-2">Only the Principal can change plans</span>
              ) : available ? (
                <button onClick={() => setCheckout({ plan: key, cycle })} className="mt-4 w-full px-3 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition">
                  {verb} — {p.name}
                </button>
              ) : (
                <span className="mt-4 text-center text-xs text-ink-soft py-2">Contact support for {cycle} billing</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
        <h2 className="font-display text-lg text-ink mb-3">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-ink-soft">No invoices yet. A GST invoice is created automatically for every payment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-ink-soft border-b border-cream-deep">
                <th className="py-2 font-normal">Invoice</th><th className="font-normal">Date</th><th className="font-normal">For</th><th className="font-normal text-right">Amount</th><th />
              </tr></thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id} className="border-b border-cream-deep/50">
                    <td className="py-2 font-mono text-xs">{i.invoice_number}</td>
                    <td>{dateIN(i.issued_at)}</td>
                    <td className="text-ink-soft">{i.description}</td>
                    <td className="text-right">{P(i.total_paise)}</td>
                    <td className="text-right">
                      <button onClick={() => apiDownload(`/api/billing/invoices/${i.id}/pdf`, `${i.invoice_number.replace(/\//g, '-')}.pdf`)} className="text-terracotta text-xs underline underline-offset-2">PDF</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.can_manage && (
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
          <h2 className="font-display text-lg text-ink mb-1">GST details for invoices</h2>
          <p className="text-xs text-ink-soft mb-3">Add your GSTIN to claim input tax credit. State code decides CGST+SGST vs IGST.</p>
          <GstDetails details={data.billing_details} onSaved={load} />
        </div>
      )}

      {checkout && (
        <CheckoutModal open planCode={checkout.plan} cycle={checkout.cycle} onClose={() => { setCheckout(null); load(); }} onDone={load} />
      )}
    </div>
  );
}
