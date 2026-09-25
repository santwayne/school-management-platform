import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import { SeverityChip, SEVERITY, timeAgo, formatDateTime, ErrorBanner, PageTitle } from './opsUi';

const STATUS_TABS = [
  { key: 'open', label: 'Needs action' },
  { key: 'snoozed', label: 'Snoozed' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'dismissed', label: 'Dismissed' },
];

const SOURCE_NAMES = {
  automation_failure: 'Automations',
  integration: 'Connections',
  attendance: 'Attendance',
  ocr_grading: 'AI grading',
  fee_reconciliation: 'Fees',
  parent_assistant: 'Parent messages',
  admission: 'Admissions',
  substitution: 'Substitution',
  certificate: 'Certificates',
  payslip: 'Payroll',
};

const ENTITY_LINKS = {
  // Student profiles are principal/teacher pages; the link is only shown
  // to roles that can open them.
  student: (id) => `/admin/students/${id}/profile`,
  automation: null,
  integration: null,
};

export default function ExceptionInbox() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'open';
  const source = params.get('source') || '';
  const focusId = Number(params.get('focus')) || null;

  const [items, setItems] = useState(null);
  const [sources, setSources] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState(focusId);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState('');
  const listRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ status, limit: '100' });
      if (source) q.set('source', source);
      const d = await apiRequest(`/api/ops/exceptions?${q}`);
      setItems(d.items);
      setSources(d.sources);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [status, source]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!items || !focusId) return;
    const idx = items.findIndex((i) => i.id === focusId);
    if (idx >= 0) setCursor(idx);
  }, [items, focusId]);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('focus');
    setParams(next);
    setCursor(0);
    setExpanded(null);
  };

  const act = useCallback(
    async (item, kind, extra = {}) => {
      if (!item) return;
      setBusy(`${item.id}:${kind}`);
      setNotice('');
      try {
        if (kind === 'action') {
          await apiRequest(`/api/ops/exceptions/${item.id}/action`, { method: 'POST' });
          setNotice(`${item.suggested_action?.label || 'Action'} done.`);
        } else if (kind === 'snooze') {
          await apiRequest(`/api/ops/exceptions/${item.id}/snooze`, { method: 'POST', body: { hours: extra.hours } });
          setNotice(`Snoozed for ${extra.hours} h.`);
        } else {
          await apiRequest(`/api/ops/exceptions/${item.id}/${kind}`, { method: 'POST', body: { note: note || undefined } });
          setNotice(kind === 'resolve' ? 'Marked resolved.' : 'Dismissed.');
        }
        setNote('');
        setExpanded(null);
        await load();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(null);
      }
    },
    [load, note]
  );

  const current = items?.[cursor];
  const canAct = status === 'open' || status === 'snoozed';

  // Keyboard triage: j/k move, Enter open, r resolve, s snooze 4 h,
  // d dismiss, a run the suggested action. Ignored while typing a note.
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.metaKey || e.ctrlKey || !items?.length) return;
      if (e.key === 'j') setCursor((c) => Math.min(c + 1, items.length - 1));
      else if (e.key === 'k') setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === 'Enter') setExpanded((x) => (x === current?.id ? null : current?.id));
      else if (!canAct) return;
      else if (e.key === 'r') act(current, 'resolve');
      else if (e.key === 's') act(current, 'snooze', { hours: 4 });
      else if (e.key === 'd') act(current, 'dismiss');
      else if (e.key === 'a' && current?.action_available) act(current, 'action');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, current, canAct, act]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const sourceChips = useMemo(() => [{ source: '', n: sources.reduce((a, s) => a + s.n, 0) }, ...sources], [sources]);

  return (
    <div className="space-y-5">
      <PageTitle
        title="Inbox"
        subtitle="Everything the system could not finish on its own. Clear this list and the school runs itself."
        right={<span className="hidden md:block text-xs text-ink-soft">Keys: j / k move, Enter open, r resolve, s snooze, d dismiss, a do action</span>}
      />

      <div className="flex flex-wrap gap-2" role="tablist">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={status === t.key}
            onClick={() => setFilter('status', t.key === 'open' ? '' : t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm ${status === t.key ? 'bg-ink text-cream' : 'bg-white border border-cream-deep text-ink-soft hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {status === 'open' && sources.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {sourceChips.map((s) => (
            <button
              key={s.source || 'all'}
              onClick={() => setFilter('source', s.source)}
              className={`px-2.5 py-1 rounded-full text-xs ${source === s.source ? 'bg-terracotta/15 text-terracotta-deep font-medium' : 'bg-cream-deep/60 text-ink-soft hover:text-ink'}`}
            >
              {s.source ? SOURCE_NAMES[s.source] || s.source : 'All'} {s.n}
            </button>
          ))}
        </div>
      )}

      <ErrorBanner message={error} />
      {notice && <div className="rounded-xl bg-joy-leaf/15 border border-joy-leaf/40 px-4 py-2.5 text-sm text-ink">{notice}</div>}

      {!items && <div className="text-sm text-ink-soft">Loading…</div>}
      {items && items.length === 0 && (
        <div className="bg-white rounded-2xl border border-cream-deep/70 px-6 py-12 text-center">
          <p className="font-display text-xl text-ink">{status === 'open' ? 'Inbox clear.' : 'Nothing here.'}</p>
          {status === 'open' && <p className="text-sm text-ink-soft mt-1">New items appear here the moment an automation needs a person.</p>}
        </div>
      )}

      {items && items.length > 0 && (
        <ul ref={listRef} className="bg-white rounded-2xl border border-cream-deep/70 overflow-hidden">
          {items.map((e, idx) => {
            const open = expanded === e.id;
            const selected = idx === cursor;
            const link = user?.role === 'principal' && e.entity_type && e.entity_id && ENTITY_LINKS[e.entity_type]?.(e.entity_id);
            return (
              <li key={e.id} data-idx={idx} className={`relative border-b border-cream-deep/50 last:border-0 ${selected ? 'bg-cream/70' : ''}`}>
                <span className={`absolute left-0 top-0 bottom-0 w-1 ${SEVERITY[e.severity]?.bar || ''}`} aria-hidden="true" />
                <button
                  onClick={() => {
                    setCursor(idx);
                    setExpanded(open ? null : e.id);
                  }}
                  aria-expanded={open}
                  className="w-full text-left flex flex-wrap items-start gap-x-3 gap-y-1 pl-5 pr-4 py-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terracotta"
                >
                  <SeverityChip severity={e.severity} />
                  <span className="flex-1 min-w-[12rem] text-sm text-ink font-medium">{e.title}</span>
                  <span className="text-xs text-ink-soft">
                    {e.occurrences > 1 ? `×${e.occurrences}, last ${timeAgo(e.last_seen_at)}` : timeAgo(e.created_at)}
                  </span>
                </button>

                {open && (
                  <div className="pl-5 pr-4 pb-4 space-y-3">
                    {e.body && <p className="text-sm text-ink-soft whitespace-pre-line max-w-3xl">{e.body}</p>}
                    <div className="text-xs text-ink-soft">
                      {SOURCE_NAMES[e.source] || e.source} · first seen {formatDateTime(e.created_at)}
                      {link && (
                        <>
                          {' · '}
                          <a href={link} className="text-terracotta-deep hover:underline">Open record</a>
                        </>
                      )}
                    </div>
                    {e.snoozed_until && status === 'snoozed' && <div className="text-xs text-ink-soft">Snoozed until {formatDateTime(e.snoozed_until)}</div>}
                    {e.resolution_note && <div className="text-xs text-ink">Note: {e.resolution_note}</div>}

                    {canAct && (
                      <div className="space-y-2">
                        <input
                          value={note}
                          onChange={(ev) => setNote(ev.target.value)}
                          placeholder="Note (optional), e.g. called parent, child is unwell"
                          className="w-full max-w-lg px-3 py-2 rounded-lg border border-cream-deep text-sm"
                        />
                        <div className="flex flex-wrap gap-2">
                          {e.action_available && (
                            <button disabled={!!busy} onClick={() => act(e, 'action')} className="px-3 py-1.5 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
                              {busy === `${e.id}:action` ? 'Working…' : e.suggested_action.label}
                            </button>
                          )}
                          <button disabled={!!busy} onClick={() => act(e, 'resolve')} className="px-3 py-1.5 rounded-lg bg-ink text-cream text-sm hover:opacity-90 disabled:opacity-50">
                            Mark resolved
                          </button>
                          {[1, 4, 24].map((h) => (
                            <button key={h} disabled={!!busy} onClick={() => act(e, 'snooze', { hours: h })} className="px-3 py-1.5 rounded-lg border border-cream-deep text-sm text-ink-soft hover:text-ink disabled:opacity-50">
                              Snooze {h === 24 ? '1 day' : `${h} h`}
                            </button>
                          ))}
                          <button disabled={!!busy} onClick={() => act(e, 'dismiss')} className="px-3 py-1.5 rounded-lg text-sm text-ink-soft hover:text-destructive disabled:opacity-50">
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
