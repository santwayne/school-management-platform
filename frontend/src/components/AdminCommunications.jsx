import React, { useEffect, useState } from 'react';
import { MessageSquare, Send, Clock, Users, CheckCheck, AlertCircle, ChevronDown, ChevronUp, Radio } from 'lucide-react';
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

function DeliveryBar({ delivered, failed, total }) {
  if (!total) return null;
  const pct = Math.round((delivered / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-ink-soft">
        <span>{delivered} delivered{failed > 0 ? `, ${failed} failed` : ''}</span>
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
              <div className="text-xs text-ink-soft">delivered</div>
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
                      <DeliveryBar delivered={b.delivered_count} failed={b.failed_count} total={b.recipient_count} />
                    </div>
                  </div>
                  <div className="px-4 pb-3 flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs text-ink-soft">
                      <CheckCheck className="w-3.5 h-3.5 text-terracotta" />
                      {b.delivered_count} of {b.recipient_count} delivered
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
                Sent to {sendResult.recipient_count} recipients — {sendResult.delivered_count} delivered
                {sendResult.failed_count > 0 ? `, ${sendResult.failed_count} failed` : ''}.
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
                  <div className="text-xs font-semibold text-ink">Waynur School</div>
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
