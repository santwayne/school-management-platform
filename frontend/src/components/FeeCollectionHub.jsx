import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api';
import FinanceAdmin, { StudentPicker } from './FinanceAdmin';

const INR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
// One tab bar for the whole Fees page (the old "Collect (manual)" tab used to
// nest FinanceAdmin's own Dashboard / Collect Fee / Fee Structure bar inside it).
const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'collect', label: 'Collect Fee' },
  { key: 'structure', label: 'Fee Structure' },
  { key: 'whatsapp', label: 'WhatsApp queue' },
  { key: 'online', label: 'Online payments' },
];
const LEGACY_TAB = { manual: 'collect' };

export default function FeeCollectionHub() {
  // ?tab=whatsapp|online deep-links straight to a tab (used by notifications).
  const [params, setParams] = useSearchParams();
  const requested = LEGACY_TAB[params.get('tab')] || params.get('tab');
  const tab = TABS.some((t) => t.key === requested) ? requested : 'dashboard';
  const setTab = (key) => setParams(key === 'dashboard' ? {} : { tab: key }, { replace: true });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl text-ink">Fee Collection</h1>
        <p className="text-sm text-ink-soft mt-1">Dues overview, manual collection, fee structure, WhatsApp cash slips and online payment links.</p>
      </div>
      <div className="border-b border-cream-deep/70 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              tab === t.key ? 'border-terracotta text-terracotta-deep' : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {['dashboard', 'collect', 'structure'].includes(tab) && <FinanceAdmin tab={tab} />}
      {tab === 'whatsapp' && <WhatsAppQueue />}
      {tab === 'online' && <OnlinePayments />}
    </div>
  );
}

function WhatsAppQueue() {
  const [pending, setPending] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [edits, setEdits] = useState({}); // id -> { student_id, amount }

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [p, r] = await Promise.all([
        apiRequest('/api/fee-intake/pending'),
        apiRequest('/api/fee-intake/recent'),
      ]);
      setPending(p);
      setRecent(r);
      const initialEdits = {};
      p.forEach((e) => {
        initialEdits[e.id] = {
          student_id: e.matched_student_id || '',
          amount: e.ai_extracted_amount || '',
        };
      });
      setEdits(initialEdits);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setEdit = (id, field, value) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const confirm = async (id) => {
    const e = edits[id];
    if (!e?.student_id || !e?.amount) {
      setError('Enter both a student ID and amount before confirming.');
      return;
    }
    setError('');
    try {
      await apiRequest(`/api/fee-intake/${id}/confirm`, {
        method: 'PATCH',
        body: { student_id: Number(e.student_id), amount: Number(e.amount) },
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const reject = async (id) => {
    setError('');
    try {
      await apiRequest(`/api/fee-intake/${id}/reject`, { method: 'PATCH' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {loading ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : (
        <>
          {pending.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing pending — every WhatsApp cash slip has been reviewed.</p>
          ) : (
            <div className="space-y-3">
              {pending.map((e) => (
                <div key={e.id} className="rounded-2xl bg-white border border-cream-deep/70 p-4 flex flex-col sm:flex-row gap-4">
                  <img src={`data:image/jpeg;base64,${e.photo_base64}`} alt="Cash slip" className="w-32 h-32 object-cover rounded-lg border border-cream-deep shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="text-xs text-ink-soft">
                      From {e.collector_name} · {new Date(e.received_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-xs uppercase tracking-wide text-amber-700 bg-amber-500/10 inline-block px-2 py-0.5 rounded-full">
                      Needs your confirmation
                    </div>
                    {e.ai_extracted_student_hint && (
                      <div className="text-xs text-ink-soft">AI read student name as: "{e.ai_extracted_student_hint}"</div>
                    )}
                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        type="number"
                        placeholder="Student ID"
                        value={edits[e.id]?.student_id ?? ''}
                        onChange={(ev) => setEdit(e.id, 'student_id', ev.target.value)}
                        className="w-28 px-2 py-1.5 rounded-lg border border-cream-deep bg-white text-sm"
                      />
                      <input
                        type="number"
                        placeholder="Amount"
                        value={edits[e.id]?.amount ?? ''}
                        onChange={(ev) => setEdit(e.id, 'amount', ev.target.value)}
                        className="w-28 px-2 py-1.5 rounded-lg border border-cream-deep bg-white text-sm"
                      />
                      <button onClick={() => confirm(e.id)} className="px-3 py-1.5 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition">
                        Confirm &amp; mark paid
                      </button>
                      <button onClick={() => reject(e.id)} className="px-3 py-1.5 rounded-lg border border-cream-deep text-ink-soft text-sm hover:bg-cream-deep/50">
                        Flag / reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {recent.length > 0 && (
            <div className="pt-4">
              <h3 className="text-sm font-medium text-ink-soft mb-2">Recently handled</h3>
              <div className="space-y-1">
                {recent.map((r) => (
                  <div key={r.id} className="text-xs text-ink-soft flex justify-between opacity-70 py-1">
                    <span>{r.student_name || '—'} {r.status === 'CONFIRMED' ? `— ${INR(r.confirmed_amount)}` : '— rejected'}</span>
                    <span>{r.confirmed_at ? new Date(r.confirmed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OnlinePayments() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showSend, setShowSend] = useState(false);
  const [student, setStudent] = useState(null);
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  // Whether this school's own Razorpay account is connected (set up by
  // Waynur support). null = not known yet, so nothing is blocked or warned.
  const [gateway, setGateway] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      apiRequest('/api/payment-links/status').then(setGateway).catch(() => {});
      setLinks(await apiRequest('/api/payment-links'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const send = async () => {
    if (!student || !amount) return;
    setSending(true);
    setError('');
    try {
      await apiRequest('/api/payment-links', { method: 'POST', body: { student_id: student.id, amount: Number(amount) } });
      setShowSend(false);
      setStudent(null);
      setAmount('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      {gateway && !gateway.connected && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          <strong>Online fee payments are not set up for your school yet.</strong> Payments go straight to your school's own Razorpay account, which Waynur support connects for you. Until then, payment links and automatic fee reminders are switched off — cash and manual fee entries work as usual.
        </div>
      )}
      {gateway?.connected && gateway.mode === 'test' && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          Your school's Razorpay account is connected in <strong>test mode</strong> — links can be created, but no real money moves.
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => setShowSend(true)}
          disabled={Boolean(gateway) && !gateway.connected}
          className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send payment link
        </button>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      {showSend && (
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-4 flex flex-wrap items-end gap-3">
          <label className="text-sm w-64">
            <span className="block text-xs font-medium text-ink-soft mb-1">Student</span>
            <StudentPicker selected={student} onSelect={setStudent} />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-ink-soft mb-1">Amount (₹)</span>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm" />
          </label>
          <button onClick={send} disabled={sending || !student} className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition disabled:opacity-50">
            {sending ? 'Sending…' : 'Create & send on WhatsApp'}
          </button>
          <button onClick={() => { setShowSend(false); setStudent(null); setAmount(''); }} className="px-3 py-2 text-sm text-ink-soft">Cancel</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-ink-soft">No payment links sent yet.</p>
      ) : (
        <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Student</th>
                  <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Amount</th>
                  <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Status</th>
                  <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-deep/60">
                {links.map((l) => (
                  <tr key={l.id} className="hover:bg-cream-deep/20">
                    <td className="px-4 py-3 font-medium">{l.student_name}</td>
                    <td className="px-4 py-3">{INR(l.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        l.status === 'PAID' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/15 text-amber-700'
                      }`}>
                        {l.status === 'PAID' ? 'Auto-matched · Paid' : l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft whitespace-nowrap">
                      {new Date(l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
