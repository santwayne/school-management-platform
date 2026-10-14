import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Lightbulb, Plus, Check, Archive, ArrowLeft, RefreshCw } from 'lucide-react';
import { apiRequest } from '../../api';

const KINDS = [
  { value: 'fact', label: 'Fact' },
  { value: 'preference', label: 'Preference' },
  { value: 'policy', label: 'Policy' },
];

// What the assistant knows and what it has learned. Nothing it learns on its
// own affects its answers until a person approves it here.
export default function AssistantBrain() {
  const [memory, setMemory] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('fact');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [m, s] = await Promise.all([apiRequest('/api/assistant/memory'), apiRequest('/api/assistant/suggestions')]);
      setMemory(m);
      setSuggestions(s);
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const act = async (fn, ok) => {
    setError('');
    setMessage('');
    try {
      await fn();
      if (ok) setMessage(ok);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const add = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    act(() => apiRequest('/api/assistant/memory', { method: 'POST', body: { content: text.trim(), kind } }).then(() => setText('')), 'Saved. The assistant will use this from now on.');
  };

  const pending = (memory || []).filter((m) => m.status === 'pending');
  const active = (memory || []).filter((m) => m.status === 'active');

  const review = async () => {
    setBusy(true);
    await act(async () => {
      const r = await apiRequest('/api/assistant/reflect', { method: 'POST' });
      setMessage(r.skipped ? (r.skipped === 'nothing_to_review' ? 'Nothing to review yet — it learns from your chats, feedback and Control Center activity.' : 'The review could not run.') : `Review done: ${r.lessons} new lesson(s), ${r.suggestions} idea(s).`);
    });
    setBusy(false);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link to="/ops/assistant" className="inline-flex items-center gap-1 text-xs text-ink-soft hover:text-ink"><ArrowLeft className="w-3.5 h-3.5" /> Back to chat</Link>
        <h1 className="font-display text-xl text-ink mt-1 flex items-center gap-2"><Brain className="w-5 h-5 text-terracotta" /> Assistant memory & ideas</h1>
        <p className="text-sm text-ink-soft mt-1">
          Teach the assistant how your school works. Every week it also reviews its own answers, your feedback and Control Center problems, and writes down
          what it should do better. It can never change software or data by itself — you decide what it keeps.
        </p>
      </div>

      {message && <div role="status" className="rounded-lg bg-green-100 text-green-700 text-sm px-3 py-2">{message}</div>}
      {error && <div role="alert" className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm px-3 py-2">{error}</div>}

      {pending.length > 0 && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 space-y-2">
          <div className="font-display text-base text-ink">Lessons waiting for your approval</div>
          {pending.map((m) => (
            <div key={m.id} className="flex items-start gap-2 rounded-xl bg-white border border-cream-deep/70 p-3 text-sm">
              <span className="flex-1 text-ink">{m.content}</span>
              <button onClick={() => act(() => apiRequest(`/api/assistant/memory/${m.id}`, { method: 'PATCH', body: { status: 'active' } }))} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-terracotta text-primary-foreground text-xs font-medium"><Check className="w-3.5 h-3.5" /> Keep</button>
              <button onClick={() => act(() => apiRequest(`/api/assistant/memory/${m.id}`, { method: 'PATCH', body: { status: 'archived' } }))} className="px-2.5 py-1 rounded-lg border border-cream-deep text-xs text-ink-soft">Discard</button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl bg-white border border-cream-deep/70 p-4 space-y-3">
        <div className="font-display text-base text-ink">What it remembers</div>
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border border-cream-deep px-2 py-2 text-sm bg-white">
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder='e.g. "Fees are due by the 10th of every month" or "Address parents as Mr./Ms."' className="flex-1 min-w-[220px] rounded-lg border border-cream-deep px-3 py-2 text-sm" />
          <button className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep"><Plus className="w-4 h-4" /> Add</button>
        </form>
        {memory === null ? <div className="text-sm text-ink-soft">Loading…</div> : active.length === 0 ? (
          <div className="text-sm text-ink-soft">Nothing yet. Ask the assistant in chat to "remember" something, or add it above. Please don't store personal details about individual students or parents.</div>
        ) : (
          <div className="divide-y divide-cream-deep/60 border border-cream-deep/70 rounded-xl overflow-hidden">
            {active.map((m) => (
              <div key={m.id} className="flex items-start gap-2 px-3 py-2.5 text-sm">
                <span className="text-[11px] uppercase tracking-wide text-ink-soft mt-0.5 w-20 shrink-0">{m.kind}</span>
                <span className="flex-1 text-ink">{m.content}</span>
                <button aria-label="Forget" title="Forget" onClick={() => act(() => apiRequest(`/api/assistant/memory/${m.id}`, { method: 'PATCH', body: { status: 'archived' } }))} className="p-1 text-ink-soft hover:text-destructive"><Archive className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-white border border-cream-deep/70 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="font-display text-base text-ink flex items-center gap-2"><Lightbulb className="w-4 h-4 text-terracotta" /> Ideas to make the software better</div>
          <button disabled={busy} onClick={review} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-cream-deep text-ink hover:bg-cream-deep/40 disabled:opacity-50"><RefreshCw className="w-3.5 h-3.5" /> Run review now</button>
        </div>
        {suggestions.length === 0 ? (
          <div className="text-sm text-ink-soft">No new ideas. The review runs every Monday morning.</div>
        ) : suggestions.map((s) => (
          <div key={s.id} className="rounded-xl border border-cream-deep/70 p-3 text-sm space-y-1">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="font-medium text-ink">{s.title}</div>
                <div className="text-[11px] uppercase tracking-wide text-ink-soft">{s.category.replace('_', ' ')}</div>
              </div>
              <button onClick={() => act(() => apiRequest(`/api/assistant/suggestions/${s.id}`, { method: 'PATCH', body: { status: 'accepted' } }), 'Marked as accepted — pass it to your Waynur team.')} className="px-2.5 py-1 rounded-lg bg-terracotta text-primary-foreground text-xs font-medium">Accept</button>
              <button onClick={() => act(() => apiRequest(`/api/assistant/suggestions/${s.id}`, { method: 'PATCH', body: { status: 'dismissed' } }))} className="px-2.5 py-1 rounded-lg border border-cream-deep text-xs text-ink-soft">Dismiss</button>
            </div>
            {s.detail && <p className="text-ink-soft">{s.detail}</p>}
            {s.evidence && <p className="text-xs text-ink-soft">Why: {s.evidence}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
