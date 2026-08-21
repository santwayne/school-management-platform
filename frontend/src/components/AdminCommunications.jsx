import React, { useEffect, useState } from 'react';
import { MessageSquare, Send, Clock, Users, CheckCheck, AlertCircle, ChevronDown, ChevronUp, Radio, Sparkles } from 'lucide-react';
import { apiRequest } from '../api';

const AUDIENCES = [
  { value: 'all_parents', label: 'All Parents', desc: 'Every parent registered in the system' },
  { value: 'all_staff', label: 'All Staff', desc: 'All teachers and admin staff' },
];

function AudienceBadge({ label }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-terracotta/10 text-terracotta-deep border border-terracotta/20">
      <Users className="w-3 h-3" />
      {label}
    </span>
  );
}

// "Sent" here means Meta's API accepted the message for delivery, NOT that
// it actually reached the phone — that only becomes known asynchronously,
// via the confirmedDelivered figure (populated by the status webhook) and
// the per-recipient breakdown below. Labeling this "delivered" was the root
// of P-3 (a broadcast could show "delivered" and never arrive).
function DeliveryBar({ sent, failed, confirmedDelivered, total }) {
  if (!total) return null;
  const pct = Math.round((sent / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-ink-soft">
        <span>
          {sent} sent{failed > 0 ? `, ${failed} failed` : ''}
          {confirmedDelivered > 0 ? ` · ${confirmedDelivered} confirmed delivered` : ''}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-cream-deep overflow-hidden">
        <div className="h-full rounded-full bg-terracotta transition-all" style={{ width: `${pct}%` }} />
        {failed > 0 && (
          <div className="h-full rounded-full bg-destructive/60" style={{ width: `${Math.round((failed / total) * 100)}%`, marginLeft: `${pct}%`, marginTop: '-4px' }} />
        )}
      </div>
    </div>
  );
}

const RECIPIENT_STATUS_STYLE = {
  SENT: 'bg-cream-deep text-ink-soft',
  DELIVERED: 'bg-emerald-500/10 text-emerald-700',
  READ: 'bg-emerald-500/10 text-emerald-700',
  FAILED: 'bg-destructive/10 text-destructive',
};

function RecipientBreakdown({ broadcastId }) {
  const [recipients, setRecipients] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest(`/api/communications/${broadcastId}/recipients`)
      .then(setRecipients)
      .catch((err) => setError(err.message));
  }, [broadcastId]);

  if (error) return <p className="text-xs text-destructive px-1">{error}</p>;
  if (!recipients) return <p className="text-xs text-ink-soft px-1">Loading recipients…</p>;
  if (recipients.length === 0) return <p className="text-xs text-ink-soft px-1">No individual recipients recorded for this broadcast.</p>;

  return (
    <div className="rounded-xl border border-cream-deep/70 bg-cream/40 divide-y divide-cream-deep/60 max-h-64 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      {recipients.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
          <div className="min-w-0">
            <div className="text-ink font-medium truncate">{r.recipient_label || 'Unknown'}</div>
            <div className="text-ink-soft truncate">{r.phone}</div>
          </div>
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${RECIPIENT_STATUS_STYLE[r.status] || 'bg-cream-deep text-ink-soft'}`}>
              {r.status}
            </span>
            {r.error_message && <span className="text-[10px] text-destructive max-w-[160px] truncate" title={r.error_message}>{r.error_message}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminCommunications() {
  const [tab, setTab] = useState('history');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  const [audience, setAudience] = useState('all_parents');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  // Item 14: the WhatsApp preview hardcoded the literal string "Waynur
  // School" as the sender name — always wrong for every real tenant, and
  // it never self-corrected since it wasn't reading real settings at all.
  // Same fetch AdminShell.jsx uses for its header school name; no shared
  // context/hook exists yet for this in the app (every shell fetches
  // /api/settings independently), so this matches the existing convention
  // rather than introducing a new one.
  const [schoolName, setSchoolName] = useState('');

  // AI roadmap #3 — drafts message TEXT only, never sends anything itself.
  // The principal still reviews/edits the draft in the same textarea and
  // clicks Send broadcast same as always.
  const [draftPrompt, setDraftPrompt] = useState('');
  const [drafting, setDrafting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setHistory(await apiRequest('/api/communications'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    apiRequest('/api/settings').then((s) => setSchoolName(s.school_name || '')).catch(() => {});
  }, []);

  const draftWithAI = async () => {
    if (!draftPrompt.trim()) return;
    setDrafting(true);
    setError('');
    try {
      const label = AUDIENCES.find((a) => a.value === audience)?.label || audience;
      const { draft } = await apiRequest('/api/communications/draft', {
        method: 'POST',
        body: { prompt: draftPrompt.trim(), audience_label: label },
      });
      setMessage(draft.slice(0, 1000));
    } catch (err) {
      setError(err.message);
    } finally {
      setDrafting(false);
    }
  };

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    setError('');
    setSendResult(null);
    try {
      const label = AUDIENCES.find((a) => a.value === audience)?.label || audience;
      const result = await apiRequest('/api/communications/send', {
        method: 'POST',
        body: { audience, audience_label: label, message: message.trim() },
      });
      setSendResult(result);
      setMessage('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const totalBroadcasts = history.length;
  const totalDelivered = history.reduce((s, b) => s + (b.delivered_count || 0), 0);

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-terracotta/10 border border-terracotta/20 flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5 text-terracotta" />
          </div>
          <div>
            <h1 className="font-display text-2xl text-ink">Communications</h1>
            <p className="text-sm text-ink-soft">WhatsApp broadcasts to parents and staff</p>
          </div>
        </div>
        {totalBroadcasts > 0 && (
          <div className="hidden sm:flex items-center gap-4 text-right">
            <div>
              <div className="text-lg font-semibold text-ink">{totalBroadcasts}</div>
              <div className="text-xs text-ink-soft">broadcasts</div>
            </div>
            <div className="w-px h-8 bg-cream-deep" />
            <div>
              <div className="text-lg font-semibold text-ink">{totalDelivered}</div>
              <div className="text-xs text-ink-soft">sent</div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-cream-deep/50 rounded-xl border border-cream-deep w-fit">
        {[{ key: 'history', label: 'History', icon: Clock }, { key: 'compose', label: 'Compose', icon: Radio }].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSendResult(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
                tab === t.key
                  ? 'bg-white text-terracotta-deep shadow-sm border border-cream-deep/80'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {t.key === 'history' && history.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-terracotta/15 text-terracotta-deep font-semibold">
                  {history.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-destructive/8 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div className="space-y-3">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl border border-cream-deep/70 bg-white/70 p-4 animate-pulse">
                  <div className="h-4 bg-cream-deep rounded w-1/3 mb-3" />
                  <div className="h-3 bg-cream-deep rounded w-full mb-1.5" />
                  <div className="h-3 bg-cream-deep rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-cream-deep/80 flex items-center justify-center mb-4">
                <MessageSquare className="w-6 h-6 text-ink-soft/50" />
              </div>
              <p className="text-sm font-medium text-ink">No broadcasts yet</p>
              <p className="text-xs text-ink-soft mt-1 max-w-xs">Switch to Compose to send your first WhatsApp broadcast to parents or staff.</p>
              <button
                onClick={() => setTab('compose')}
                className="mt-4 px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition"
              >
                Compose message
              </button>
            </div>
          ) : (
            history.map((b) => {
              const isOpen = expanded === b.id;
              return (
                <div
                  key={b.id}
                  className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden transition hover:shadow-sm cursor-pointer"
                  onClick={() => setExpanded(isOpen ? null : b.id)}
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <AudienceBadge label={b.audience_label} />
                      <span className="text-xs text-ink-soft shrink-0">
                        {new Date(b.sent_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className={`text-sm text-ink leading-relaxed ${isOpen ? '' : 'line-clamp-2'}`}>{b.message}</p>
                    <div className="mt-3">
                      <DeliveryBar sent={b.delivered_count} failed={b.failed_count} confirmedDelivered={b.confirmed_delivered_count} total={b.recipient_count} />
                    </div>
                    {b.no_number_count > 0 && (
                      <p className="mt-1.5 text-[11px] text-ink-soft">
                        {b.no_number_count} {b.no_number_count === 1 ? 'recipient' : 'recipients'} skipped — no WhatsApp number on file
                      </p>
                    )}
                    {isOpen && (
                      <div className="mt-3">
                        <RecipientBreakdown broadcastId={b.id} />
                      </div>
                    )}
                  </div>
                  <div className="px-4 pb-3 flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs text-ink-soft">
                      <CheckCheck className="w-3.5 h-3.5 text-terracotta" />
                      {b.delivered_count} of {b.recipient_count} sent
                    </div>
                    <span className="text-xs text-ink-soft flex items-center gap-0.5">
                      {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {isOpen ? 'Collapse' : 'Expand'}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Compose Tab */}
      {tab === 'compose' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Form */}
          <div className="lg:col-span-3 space-y-4">
            {/* Audience */}
            <div>
              <span className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Audience</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {AUDIENCES.map((a) => (
                  <button
                    key={a.value}
                    onClick={() => setAudience(a.value)}
                    className={`text-left p-3 rounded-xl border transition ${
                      audience === a.value
                        ? 'border-terracotta bg-terracotta/5 ring-1 ring-terracotta/30'
                        : 'border-cream-deep bg-white hover:border-terracotta/30'
                    }`}
                  >
                    <div className={`text-sm font-medium ${audience === a.value ? 'text-terracotta-deep' : 'text-ink'}`}>{a.label}</div>
                    <div className="text-xs text-ink-soft mt-0.5">{a.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* AI draft */}
            <div>
              <span className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Draft with AI (optional)</span>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={draftPrompt}
                  onChange={(e) => setDraftPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); draftWithAI(); } }}
                  placeholder="e.g. remind parents about Saturday's PTM from 9am to 1pm"
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-cream-deep bg-white text-sm text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-terracotta/30 focus:border-terracotta/50 transition"
                />
                <button
                  onClick={draftWithAI}
                  disabled={drafting || !draftPrompt.trim()}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-terracotta/30 text-terracotta-deep text-sm font-medium hover:bg-terracotta/5 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  <Sparkles className="w-4 h-4" />
                  {drafting ? 'Drafting…' : 'Draft'}
                </button>
              </div>
              <p className="text-[11px] text-ink-soft mt-1">Fills the message below — review and edit it before sending, same as typing it yourself.</p>
            </div>

            {/* Message */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Message</span>
                <span className={`text-xs ${message.length > 900 ? 'text-destructive' : 'text-ink-soft'}`}>{message.length}/1000</span>
              </div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 1000))}
                rows={6}
                className="w-full px-4 py-3 rounded-xl border border-cream-deep bg-white text-sm text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-terracotta/30 focus:border-terracotta/50 resize-none transition"
                placeholder="Type the WhatsApp message to broadcast…"
              />
            </div>

            {sendResult && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-700">
                <CheckCheck className="w-4 h-4 shrink-0" />
                Sent to {sendResult.recipient_count} recipients — {sendResult.delivered_count} accepted
                {sendResult.failed_count > 0 ? `, ${sendResult.failed_count} failed` : ''}
                {sendResult.no_number_count > 0 ? `, ${sendResult.no_number_count} skipped (no WhatsApp number on file)` : ''}.
                Actual delivery confirms asynchronously — check History for real-time status.
              </div>
            )}

            <button
              onClick={send}
              disabled={sending || !message.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              {sending ? 'Sending…' : 'Send broadcast'}
            </button>
          </div>

          {/* WhatsApp Preview */}
          <div className="lg:col-span-2">
            <span className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Preview</span>
            <div className="mt-2 rounded-2xl bg-[#e5ddd5] border border-cream-deep/70 p-4 min-h-40 flex flex-col gap-3">
              <div className="flex items-center gap-2 pb-2 border-b border-black/10">
                <div className="w-7 h-7 rounded-full bg-[#25D366] flex items-center justify-center">
                  <span className="text-white text-xs font-bold">W</span>
                </div>
                <div>
                  <div className="text-xs font-semibold text-ink">{schoolName || 'Your school'}</div>
                  <div className="text-[10px] text-ink-soft">via WhatsApp</div>
                </div>
              </div>
              {message ? (
                <div className="ml-auto max-w-[85%] bg-[#dcf8c6] rounded-2xl rounded-tr-sm px-3 py-2 shadow-sm">
                  <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{message}</p>
                  <p className="text-[10px] text-ink-soft/70 text-right mt-1">now ✓✓</p>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-xs text-ink-soft/60 text-center">Your message will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
