import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Send, Check, X, RotateCcw, Lightbulb } from 'lucide-react';
import { apiRequest } from '../../api';
import { ErrorBanner, PageTitle, formatDateTime } from './opsUi';

// A1 — the weekly "needs attention" list. Same screen for the principal /
// operator (all classes, with fee context, Check now / Tell class teachers)
// and for a class teacher (own class only, from the Teacher Portal).

const STATUS = {
  open: { label: 'Open', chip: 'bg-terracotta/15 text-terracotta-deep' },
  acted: { label: 'Acted on', chip: 'bg-joy-leaf/20 text-ink' },
  false_alarm: { label: 'False alarm', chip: 'bg-cream-deep text-ink-soft' },
  dismissed: { label: 'Dismissed', chip: 'bg-cream-deep text-ink-soft' },
};

function FlagCard({ flag, onDecide, busy }) {
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const s = STATUS[flag.status] || STATUS.open;
  return (
    <li className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium text-ink">{flag.student_name}</span>
        <span className="text-sm text-ink-soft">{flag.class_name}</span>
        <span className={`ml-auto inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold ${s.chip}`}>{s.label}</span>
      </div>
      <p className="text-sm text-ink">{flag.reason}</p>
      <ul className="flex flex-wrap gap-1.5">
        {flag.signals.map((sig) => (
          <li key={sig.key} className={`text-xs rounded-lg px-2 py-1 ${sig.principal_only ? 'bg-amber-warm/20 text-ink' : 'bg-cream text-ink-soft'}`} title={sig.principal_only ? 'Only the principal and operator see this' : undefined}>
            <span className="font-medium text-ink">{sig.label}:</span> {sig.evidence}
            {sig.principal_only && <span className="ml-1 text-[10px] uppercase tracking-wide text-ink-soft">principal only</span>}
          </li>
        ))}
      </ul>
      {flag.first_step && (
        <div className="flex gap-2 rounded-xl bg-cream/70 px-3 py-2 text-sm text-ink">
          <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-terracotta" aria-hidden="true" />
          <span><span className="font-medium">Suggested first step:</span> {flag.first_step}</span>
        </div>
      )}

      {flag.status === 'open' ? (
        asking ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do? (optional)" maxLength={500} className="flex-1 px-3 py-2 rounded-lg border border-cream-deep text-sm" />
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => onDecide(flag, 'acted', note)} className="px-3 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">Save</button>
              <button onClick={() => setAsking(false)} className="px-3 py-2 rounded-lg text-sm text-ink-soft hover:text-ink">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => setAsking(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
              <Check className="w-4 h-4" /> I acted on it
            </button>
            <button disabled={busy} onClick={() => onDecide(flag, 'false_alarm')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-deep text-sm text-ink hover:bg-cream disabled:opacity-50">
              <X className="w-4 h-4" /> False alarm
            </button>
            <button disabled={busy} onClick={() => onDecide(flag, 'dismissed')} className="px-3 py-1.5 rounded-lg text-sm text-ink-soft hover:text-ink disabled:opacity-50">Dismiss</button>
          </div>
        )
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
          <span>{flag.decided_by_name ? `${flag.decided_by_name}, ` : ''}{formatDateTime(flag.decided_at)}</span>
          {flag.action_note && <span className="text-ink">“{flag.action_note}”</span>}
          <button disabled={busy} onClick={() => onDecide(flag, 'open')} className="inline-flex items-center gap-1 text-terracotta-deep hover:underline disabled:opacity-50">
            <RotateCcw className="w-3 h-3" /> Reopen
          </button>
        </div>
      )}
    </li>
  );
}

export default function NeedsAttention({ teacher = false }) {
  const [data, setData] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [period, setPeriod] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (forPeriod = period) => {
    try {
      const qs = new URLSearchParams();
      if (forPeriod) qs.set('period', forPeriod);
      if (onlyOpen) qs.set('status', 'open');
      setData(await apiRequest(`/api/ai-automation/attention?${qs}`, { fresh: true }));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [period, onlyOpen]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!teacher) apiRequest('/api/ai-automation/metrics').then(setMetrics).catch(() => {});
  }, [teacher]);

  const decide = async (flag, status, note) => {
    setBusy(true);
    try {
      await apiRequest(`/api/ai-automation/attention/${flag.id}/decision`, { method: 'POST', body: { status, note } });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const run = async (path, body, done) => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const out = await apiRequest(path, { method: 'POST', body });
      setMessage(done(out));
      // "Check now" returns the week it just built — show that week straight
      // away instead of the previously selected one (or "No list yet").
      if (out?.period && out.period !== period) setPeriod(out.period);
      await load(out?.period || period);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const ew = metrics?.early_warning;
  const body = (
    <div className="space-y-6">
      <PageTitle
        title="Needs attention"
        subtitle={
          teacher
            ? 'Students in your class whose attendance, marks, homework or tutor sessions changed in a way worth a check-in. Mark what you did — it helps the list get better.'
            : 'Every Sunday night the system combines attendance, marks, homework, leave and AI tutor notes. A student is listed only when several signals point the same way. Nothing here is sent to parents.'
        }
        right={
          !teacher && (
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => run('/api/ai-automation/attention/run', {}, (o) => `Checked ${o.checked} students — ${o.flagged} listed for ${o.period}.`)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cream-deep text-sm text-ink hover:bg-white disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> Check now
              </button>
              {data?.period && (
                <button
                  disabled={busy || Boolean(data.teachers_notified_at)}
                  title={data.teachers_notified_at ? `Class teachers were told on ${formatDateTime(data.teachers_notified_at)}` : undefined}
                  onClick={() => run('/api/ai-automation/attention/notify-teachers', { period: data.period }, (o) => `${o.teachers_notified ? `${o.teachers_notified} class teacher(s) notified.` : 'No new class teachers to notify.'}${o.teachers_already_notified ? ` ${o.teachers_already_notified} were already told this week.` : ''}${o.students_without_class_teacher ? ` ${o.students_without_class_teacher} listed student(s) are in classes with no class teacher set.` : ''}`)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {data.teachers_notified_at ? <><Check className="w-4 h-4" /> Class teachers told</> : <><Send className="w-4 h-4" /> Tell class teachers</>}
                </button>
              )}
            </div>
          )
        }
      />
      <ErrorBanner message={error} />
      {message && <div className="rounded-xl bg-joy-leaf/15 px-4 py-3 text-sm text-ink">{message}</div>}

      {ew && ew.total > 0 && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {[
            ['Listed (8 weeks)', ew.total],
            ['Still open', ew.open],
            ['Acted on', ew.action_rate === null ? '—' : `${ew.action_rate}%`],
            ['False alarms', ew.false_alarm_rate === null ? '—' : `${ew.false_alarm_rate}%`],
          ].map(([label, value]) => (
            <div key={label} className="bg-white rounded-xl border border-cream-deep/70 px-4 py-3">
              <dt className="text-xs text-ink-soft">{label}</dt>
              <dd className="font-display text-xl text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {data?.periods?.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="text-ink-soft">Week</span>
            <select value={period || data.period || ''} onChange={(e) => setPeriod(e.target.value)} className="px-3 py-1.5 rounded-lg border border-cream-deep bg-white">
              {data.periods.map((p) => (
                <option key={p.period} value={p.period}>{p.period} ({p.open} open of {p.n})</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-ink">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} className="w-4 h-4 accent-terracotta" />
          Open only
        </label>
      </div>

      {!data ? (
        <div className="text-sm text-ink-soft">Loading…</div>
      ) : teacher && !data.class_teacher && data.flags.length === 0 && !data.period ? (
        <div className="bg-white rounded-2xl border border-cream-deep/70 px-5 py-6 text-sm text-ink-soft">This list is for class teachers. Ask the principal to set you as class teacher of your class.</div>
      ) : data.flags.length === 0 ? (
        <div className="bg-white rounded-2xl border border-cream-deep/70 px-5 py-6 text-sm text-ink-soft">
          {data.period ? (onlyOpen ? 'Nothing open for this week.' : 'No students were listed this week.') : 'No list yet — the first one is made on Sunday night.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {data.flags.map((f) => (
            <FlagCard key={f.id} flag={f} onDecide={decide} busy={busy} />
          ))}
        </ul>
      )}
    </div>
  );

  if (!teacher) return body;
  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <Link to="/teacher" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
          <ArrowLeft className="w-4 h-4" /> Teacher Portal
        </Link>
        {body}
      </div>
    </div>
  );
}

export function TeacherNeedsAttention() {
  return <NeedsAttention teacher />;
}
