import React, { useCallback, useEffect, useState } from 'react';
import { Search, Send, UserCog, Bot } from 'lucide-react';
import { apiRequest } from '../../api';

function timeAgo(value) {
  if (!value) return 'never';
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const INTENT_LABELS = {
  fee_balance: 'Fee balance', pay_now: 'Payment', fee_receipt: 'Receipt', homework_today: 'Homework',
  homework_doubt: 'Homework doubt', attendance: 'Attendance', results: 'Results', leave_request: 'Leave request',
  holidays_events: 'Holidays/events', bus_location: 'Bus location', timetable: 'Timetable',
  certificate_request: 'Certificate', talk_to_teacher: 'Talk to teacher', complaint: 'Complaint',
  safety: 'Safety concern', menu: 'Menu', thanks: 'Thanks', absence_reply: 'Absence reply',
};

const HANDLED_TONE = { assistant: 'text-ink-soft', doubt_bot: 'text-ink-soft', staff: 'text-terracotta-deep', escalated: 'text-destructive', fallback: 'text-ink-soft' };

function ConversationThread({ parentId, onTakeoverChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiRequest(`/api/parent-conversations/${parentId}`).then(setData).catch((e) => setError(e.message));
  }, [parentId]);
  useEffect(() => { load(); }, [load]);

  const send = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    setError('');
    try {
      await apiRequest(`/api/parent-conversations/${parentId}/reply`, { method: 'POST', body: { text: reply.trim() } });
      setReply('');
      load();
      onTakeoverChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const takeover = async (hours) => {
    setBusy(true);
    try {
      await apiRequest(`/api/parent-conversations/${parentId}/takeover`, { method: 'POST', body: { hours } });
      load();
      onTakeoverChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <div className="p-5 text-sm text-destructive">{error}</div> : <div className="p-5 text-sm text-ink-soft">Loading…</div>;

  const takenOver = data.human_takeover_until && new Date(data.human_takeover_until) > new Date();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-cream-deep/60">
        <div>
          <div className="font-medium text-ink">{data.name || data.phone}</div>
          <div className="text-xs text-ink-soft">{data.phone} · {data.children.map((c) => `${c.name} (${c.class_name}${c.section || ''})`).join(', ') || 'no linked child'}</div>
        </div>
        <button
          disabled={busy}
          onClick={() => takeover(takenOver ? 0 : 24)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${takenOver ? 'bg-terracotta/15 text-terracotta-deep' : 'border border-cream-deep text-ink-soft hover:text-ink'}`}
        >
          {takenOver ? <><UserCog className="w-3.5 h-3.5" /> You're handling this</> : <><Bot className="w-3.5 h-3.5" /> Take over</>}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {data.messages.length === 0 && <p className="text-sm text-ink-soft text-center py-8">No messages yet.</p>}
        {data.messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-xl px-3.5 py-2 text-sm ${m.direction === 'out' ? 'bg-terracotta text-white' : 'bg-cream-deep/50 text-ink'}`}>
              <p className="whitespace-pre-line">{m.body}</p>
              <div className={`text-[10px] mt-1 flex items-center gap-1.5 ${m.direction === 'out' ? 'text-white/70' : HANDLED_TONE[m.handled_by] || 'text-ink-soft'}`}>
                {formatDateTime(m.created_at)}
                {m.intent && ` · ${INTENT_LABELS[m.intent] || m.intent}`}
                {m.student_name && ` · re: ${m.student_name}`}
                {m.direction === 'out' && m.handled_by && ` · ${m.handled_by === 'staff' ? 'you' : m.handled_by}`}
              </div>
            </div>
          </div>
        ))}
      </div>

      {error && <div className="mx-5 mb-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">{error}</div>}
      <form onSubmit={send} className="border-t border-cream-deep/60 p-3 flex gap-2">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          disabled={!data.can_reply}
          placeholder={data.can_reply ? 'Type a reply…' : "Outside WhatsApp's 24h window, or not opted in"}
          className="flex-1 px-3 py-2 rounded-lg border border-cream-deep text-sm disabled:bg-cream-deep/30"
        />
        <button disabled={sending || !data.can_reply || !reply.trim()} className="px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50 inline-flex items-center gap-1.5">
          <Send className="w-4 h-4" /> Send
        </button>
      </form>
    </div>
  );
}

export default function ParentMessages() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => {
    apiRequest('/api/parent-conversations').then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = (data?.items || []).filter((c) => !q || (c.name || '').toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl text-ink">Parent messages</h1>
          <p className="text-sm text-ink-soft mt-1 max-w-2xl">Every WhatsApp conversation the assistant is handling — jump in whenever it needs a human.</p>
        </div>
        {data && (
          <div className="flex gap-4 text-xs text-ink-soft">
            <span><strong className="text-ink">{data.stats_7d.messages}</strong> messages (7d)</span>
            <span><strong className="text-ink">{data.stats_7d.answered}</strong> answered</span>
            <span><strong className="text-destructive">{data.stats_7d.escalated}</strong> escalated</span>
          </div>
        )}
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="bg-white rounded-2xl border border-cream-deep/70 overflow-hidden grid md:grid-cols-[320px_1fr] h-[560px]">
        <div className="border-r border-cream-deep/60 flex flex-col h-full">
          <div className="p-3 border-b border-cream-deep/60">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parents…" className="w-full pl-9 pr-3 py-2 rounded-lg border border-cream-deep text-sm" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!data && <div className="p-5 text-sm text-ink-soft">Loading…</div>}
            {data && filtered.length === 0 && <div className="p-5 text-sm text-ink-soft text-center">No conversations yet.</div>}
            {filtered.map((c) => (
              <button
                key={c.parent_id}
                onClick={() => setSelected(c.parent_id)}
                className={`w-full text-left px-4 py-3 border-b border-cream-deep/40 hover:bg-cream/60 ${selected === c.parent_id ? 'bg-cream/70' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink truncate">{c.name || c.phone}</span>
                  <span className="text-[11px] text-ink-soft shrink-0">{timeAgo(c.last_at)}</span>
                </div>
                <div className="text-xs text-ink-soft truncate mt-0.5">
                  {c.last_direction === 'out' && <span className="text-ink-soft/70">You: </span>}
                  {c.last_message}
                </div>
                {c.human_takeover_until && new Date(c.human_takeover_until) > new Date() && (
                  <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] bg-terracotta/15 text-terracotta-deep font-medium">You're handling this</span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          {selected ? (
            <ConversationThread parentId={selected} onTakeoverChanged={load} />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-ink-soft">Select a conversation</div>
          )}
        </div>
      </div>
    </div>
  );
}
