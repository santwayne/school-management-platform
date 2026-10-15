import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Check, ThumbsDown, ArrowRight, Sun, Send } from 'lucide-react';
import { apiRequest } from '../../api';

// B1 — "what I would do today", top of the Control Center. Each item says
// why; some carry a one-tap action that only runs when approved here (or by
// replying APPROVE <n> to the morning WhatsApp).

export default function TodayPlan() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => apiRequest('/api/ai-automation/plan').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const generate = (force) => act(() => apiRequest('/api/ai-automation/plan/generate', { method: 'POST', body: { force } }));
  const decide = (id, approve) => act(() => apiRequest(`/api/assistant/actions/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST' }));
  const sendNow = () => act(() => apiRequest('/api/ai-automation/plan/send', { method: 'POST' }));
  const feedback = (key, value) => act(() => apiRequest(`/api/ai-automation/plan/items/${encodeURIComponent(key)}/feedback`, { method: 'POST', body: { feedback: value } }));

  if (!data) return null;
  const plan = data.plan;

  return (
    <section className="bg-white rounded-2xl border border-cream-deep/70">
      <div className="flex items-center gap-3 px-5 pt-4 pb-2">
        <Sun className="w-5 h-5 text-terracotta" aria-hidden="true" />
        <h2 className="font-display text-lg text-ink flex-1">Today's plan</h2>
        {plan && (
          <button disabled={busy} onClick={() => generate(true)} className="inline-flex items-center gap-1 text-xs text-terracotta-deep hover:underline disabled:opacity-50" title="Rebuild from the latest data">
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Refresh
          </button>
        )}
      </div>
      {error && <div className="mx-5 mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {plan && <WhatsAppStatus plan={plan} busy={busy} onSend={sendNow} />}

      {!plan ? (
        <div className="px-5 pb-4 text-sm text-ink-soft">
          The plan is made at 7:30 AM (Monday–Saturday).{' '}
          <button disabled={busy} onClick={() => generate(false)} className="text-terracotta-deep font-medium hover:underline disabled:opacity-50">Make today's plan now</button>
        </div>
      ) : plan.items.length === 0 ? (
        <div className="px-5 pb-4 text-sm text-ink-soft">Nothing stands out today.</div>
      ) : (
        <>
          {plan.summary && <p className="px-5 text-sm text-ink-soft">{plan.summary}</p>}
          <ol className="divide-y divide-cream-deep/50">
            {plan.items.map((it, i) => (
              <li key={it.key} className="px-5 py-3.5 flex gap-3">
                <span className="font-display text-lg text-terracotta leading-6 w-5 shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="text-sm font-medium text-ink">{it.title}</div>
                  <div className="text-sm text-ink-soft">{it.why}</div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    {it.action_id && it.action_status === 'pending' && (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <button disabled={busy} onClick={() => decide(it.action_id, true)} className="px-3 py-1 rounded-lg bg-terracotta text-white text-xs font-medium hover:bg-terracotta-deep disabled:opacity-50" title={it.action_summary}>
                          Approve: {it.action_summary}
                        </button>
                        <button disabled={busy} onClick={() => decide(it.action_id, false)} className="text-xs text-ink-soft hover:text-ink disabled:opacity-50">Not now</button>
                      </span>
                    )}
                    {it.action_id && it.action_status && it.action_status !== 'pending' && (
                      <span className="text-xs text-ink-soft">{it.action_status === 'approved' ? 'Done' : it.action_status === 'failed' ? `Could not run: ${it.action_result || ''}` : 'Skipped'}</span>
                    )}
                    {it.link && (
                      <Link to={it.link} className="inline-flex items-center gap-1 text-terracotta-deep hover:underline">
                        Open <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    )}
                    <span className="ml-auto inline-flex items-center gap-1">
                      <button disabled={busy} onClick={() => feedback(it.key, it.feedback === 'done' ? null : 'done')} className={`p-1 rounded ${it.feedback === 'done' ? 'text-joy-leaf' : 'text-ink-soft hover:text-ink'}`} aria-label="Mark done" title="Done">
                        <Check className="w-4 h-4" />
                      </button>
                      <button disabled={busy} onClick={() => feedback(it.key, it.feedback === 'not_useful' ? null : 'not_useful')} className={`p-1 rounded ${it.feedback === 'not_useful' ? 'text-destructive' : 'text-ink-soft hover:text-ink'}`} aria-label="Not useful" title="Not useful">
                        <ThumbsDown className="w-4 h-4" />
                      </button>
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

// Whether this morning's plan reached WhatsApp, per number, with Meta's reason
// when it did not — plus a button to send it now to confirm delivery.
function WhatsAppStatus({ plan, busy, onSend }) {
  const results = Array.isArray(plan.whatsapp_result) ? plan.whatsapp_result : null;
  const at = plan.whatsapp_sent_at ? new Date(plan.whatsapp_sent_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <div className="mx-5 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="text-ink-soft">WhatsApp:</span>
      {!results ? (
        <span className="text-ink-soft">not sent yet</span>
      ) : (
        results.map((r, i) => (
          <span key={i} className={r.ok ? 'text-emerald-700' : 'text-destructive'}>
            {r.phone ? `${r.phone} ` : ''}{r.ok ? `sent${at ? ` at ${at}` : ''}` : `failed: ${r.error}`}
          </span>
        ))
      )}
      <button disabled={busy} onClick={onSend} className="ml-auto inline-flex items-center gap-1 text-terracotta-deep hover:underline disabled:opacity-50" title="Send today's plan to the Daily report numbers now">
        <Send className="w-3.5 h-3.5" /> Send to WhatsApp now
      </button>
    </div>
  );
}
