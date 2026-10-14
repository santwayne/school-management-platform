import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Send, Plus, ThumbsUp, ThumbsDown, FileText, Check, X, Brain, Trash2 } from 'lucide-react';
import { apiRequest, apiOpenFile } from '../../api';

const STARTERS = [
  'Which students have unpaid fees this year? Show the biggest dues first.',
  "Who was absent today, and which classes are affected?",
  'Give me a summary of what needs my attention in the Control Center.',
  'Draft a circular to parents about the upcoming exam schedule.',
  'How is the admissions pipeline looking this month?',
  'Show me everything on file for a student (I will tell you the name).',
];

// **bold** and line breaks are all the formatting the assistant needs; anything
// else stays plain text (nothing from the model is ever injected as HTML).
function Rich({ text }) {
  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed">
      {String(text).split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>
      )}
    </div>
  );
}

function ActionCard({ action, onDecide }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const decide = async (kind) => {
    setBusy(true);
    setErr('');
    try {
      await apiRequest(`/api/assistant/actions/${action.id}/${kind}`, { method: 'POST' });
      onDecide();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-amber-700">Needs your approval</div>
      <div className="mt-1 text-ink">{action.summary}</div>
      {action.status === 'pending' ? (
        <div className="mt-2 flex gap-2">
          <button disabled={busy} onClick={() => decide('approve')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-terracotta text-primary-foreground text-xs font-medium hover:bg-terracotta-deep disabled:opacity-50"><Check className="w-3.5 h-3.5" /> Approve</button>
          <button disabled={busy} onClick={() => decide('reject')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-cream-deep text-xs text-ink hover:bg-white disabled:opacity-50"><X className="w-3.5 h-3.5" /> Not now</button>
        </div>
      ) : (
        <div className="mt-1 text-xs text-ink-soft capitalize">{action.status}{action.result ? ` — ${action.result}` : ''}</div>
      )}
      {err && <div className="mt-1 text-xs text-destructive">{err}</div>}
    </div>
  );
}

function Message({ m, onRate, reloadConversation }) {
  const mine = m.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${mine ? 'bg-terracotta text-primary-foreground' : 'bg-white border border-cream-deep/70 text-ink'}`}>
        <Rich text={m.text} />
        {m.documents?.map((d) => (
          <button key={d.id} onClick={() => apiOpenFile(`/api/assistant/documents/${d.id}/pdf`).catch(() => {})} className="mt-2 mr-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cream-deep/60 text-xs font-medium text-ink hover:bg-cream-deep">
            <FileText className="w-3.5 h-3.5 text-terracotta" /> {d.title} — PDF
          </button>
        ))}
        {m.actions?.map((a) => <ActionCard key={a.id} action={a} onDecide={reloadConversation} />)}
        {!mine && m.id && (
          <div className="mt-2 flex items-center gap-1 text-ink-soft">
            <button aria-label="Helpful" onClick={() => onRate(m, 1)} className={`p-1 rounded hover:bg-cream-deep/60 ${m.rating === 1 ? 'text-emerald-700' : ''}`}><ThumbsUp className="w-3.5 h-3.5" /></button>
            <button aria-label="Not helpful" onClick={() => onRate(m, -1)} className={`p-1 rounded hover:bg-cream-deep/60 ${m.rating === -1 ? 'text-destructive' : ''}`}><ThumbsDown className="w-3.5 h-3.5" /></button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Assistant() {
  const [conversations, setConversations] = useState([]);
  const [convId, setConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  const loadList = () => apiRequest('/api/assistant/conversations').then(setConversations).catch(() => {});
  const openConversation = async (id) => {
    setError('');
    try {
      const c = await apiRequest(`/api/assistant/conversations/${id}`);
      setConvId(id);
      setMessages(c.messages);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { loadList(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput('');
    setError('');
    setSending(true);
    setMessages((m) => [...m, { role: 'user', text: msg }]);
    try {
      const r = await apiRequest('/api/assistant/chat', { method: 'POST', body: { conversation_id: convId, message: msg } });
      setConvId(r.conversation_id);
      setMessages((m) => [...m, { id: r.message_id, role: 'assistant', text: r.reply, documents: r.documents, actions: r.actions }]);
      loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const rate = async (m, rating) => {
    const next = m.rating === rating ? 0 : rating;
    if (next === 0) return;
    let feedback = '';
    if (rating === -1) feedback = window.prompt('What was wrong? (optional — it helps the assistant improve)') || '';
    await apiRequest(`/api/assistant/messages/${m.id}/feedback`, { method: 'POST', body: { rating, feedback } }).catch(() => {});
    setMessages((all) => all.map((x) => (x.id === m.id ? { ...x, rating } : x)));
  };

  const removeConversation = async (id) => {
    if (!window.confirm('Delete this conversation?')) return;
    await apiRequest(`/api/assistant/conversations/${id}`, { method: 'DELETE' }).catch(() => {});
    if (id === convId) { setConvId(null); setMessages([]); }
    loadList();
  };

  return (
    <div className="grid lg:grid-cols-[240px_1fr] gap-4 h-[calc(100vh-9rem)] min-h-[480px]">
      <aside className="hidden lg:flex flex-col rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
        <button onClick={() => { setConvId(null); setMessages([]); }} className="m-3 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep">
          <Plus className="w-4 h-4" /> New chat
        </button>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {conversations.map((c) => (
            <div key={c.id} className={`group flex items-center rounded-lg ${c.id === convId ? 'bg-cream-deep/60' : 'hover:bg-cream-deep/30'}`}>
              <button onClick={() => openConversation(c.id)} className="flex-1 min-w-0 text-left px-3 py-2 text-sm text-ink truncate">{c.title || 'Chat'}</button>
              <button aria-label="Delete conversation" onClick={() => removeConversation(c.id)} className="p-2 text-ink-soft opacity-0 group-hover:opacity-100 hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
        <Link to="/ops/assistant/brain" className="m-3 inline-flex items-center gap-1.5 text-xs text-terracotta-deep font-medium hover:underline"><Brain className="w-3.5 h-3.5" /> Assistant memory & ideas</Link>
      </aside>

      <section className="flex flex-col rounded-2xl bg-cream-deep/20 border border-cream-deep/70 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="max-w-xl mx-auto pt-8 text-center">
              <Sparkles className="w-8 h-8 text-terracotta mx-auto" />
              <h1 className="font-display text-xl text-ink mt-3">Ask anything about your school</h1>
              <p className="text-sm text-ink-soft mt-1">
                Fees, attendance, staff, exams, admissions, certificates, the Control Center. I look it up in your records, draft documents as PDFs,
                and ask before I change anything. You can also message the school's WhatsApp number from your registered phone and talk to me there.
              </p>
              <div className="mt-5 grid gap-2 text-left">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-xl border border-cream-deep bg-white px-4 py-2.5 text-sm text-ink hover:border-terracotta/50 text-left">{s}</button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => <Message key={m.id || `u${i}`} m={m} onRate={rate} reloadConversation={() => convId && openConversation(convId)} />)
          )}
          {sending && <div className="text-sm text-ink-soft px-2">Looking into it…</div>}
          <div ref={bottomRef} />
        </div>

        {error && <div role="alert" className="mx-4 mb-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm px-3 py-2">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="p-3 border-t border-cream-deep/70 bg-white flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            maxLength={4000}
            placeholder="Ask about any record, or ask me to draft a document…"
            className="flex-1 resize-none rounded-xl border border-cream-deep px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-terracotta/40 max-h-32"
          />
          <button disabled={sending || !input.trim()} aria-label="Send" className="p-2.5 rounded-xl bg-terracotta text-primary-foreground hover:bg-terracotta-deep disabled:opacity-40"><Send className="w-4 h-4" /></button>
        </form>
      </section>
    </div>
  );
}
