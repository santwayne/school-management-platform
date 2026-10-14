import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, Settings2, Sparkles, Wand2 } from 'lucide-react';
import { apiRequest } from '../../api';
import { ErrorBanner, PageTitle, formatDateTime } from './opsUi';

// A2 — weekly personal notes to parents. Nothing is sent until someone
// approves it here. Same screen for the principal / operator (all classes,
// settings, consent) and a class teacher (own class) from the Teacher Portal.

const LANG = { en: 'English', hi: 'Hindi', pa: 'Punjabi', hinglish: 'Hinglish' };
const STATUS = {
  draft: { label: 'Waiting for approval', chip: 'bg-amber-warm/30 text-ink' },
  approved: { label: 'Approved — sending soon', chip: 'bg-joy-leaf/20 text-ink' },
  sending: { label: 'Sending', chip: 'bg-joy-leaf/20 text-ink' },
  sent: { label: 'Sent', chip: 'bg-joy-leaf/30 text-ink' },
  failed: { label: 'Not delivered', chip: 'bg-destructive/15 text-destructive' },
  rejected: { label: 'Not sent', chip: 'bg-cream-deep text-ink-soft' },
  expired: { label: 'Expired', chip: 'bg-cream-deep text-ink-soft' },
};

function Facts({ facts }) {
  const bits = [];
  if (facts.attendance_week) bits.push(`Attendance ${facts.attendance_week.present}/${facts.attendance_week.total} days`);
  if (facts.homework_week) bits.push(`Homework ${facts.homework_week.completed}/${facts.homework_week.assigned}`);
  for (const m of facts.marks_week || []) bits.push(`${m.subject} ${m.percent}%`);
  if (facts.strengths?.length) bits.push(`Strengths: ${facts.strengths.join('; ')}`);
  if (facts.finds_difficult?.length) bits.push(`Finds difficult: ${facts.finds_difficult.join('; ')}`);
  if (facts.next_steps?.length) bits.push(`Next steps: ${facts.next_steps.join('; ')}`);
  if (facts.teacher_notes?.length) bits.push(`Teacher notes: ${facts.teacher_notes.join(' / ')}`);
  return (
    <details className="text-xs text-ink-soft">
      <summary className="cursor-pointer hover:text-ink">What this was written from</summary>
      <ul className="mt-1 list-disc pl-5 space-y-0.5">{bits.map((b) => <li key={b}>{b}</li>)}</ul>
    </details>
  );
}

function NoteRow({ n, canApprove, selected, onSelect, onSave }) {
  const [text, setText] = useState(n.note);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => setText(n.note), [n.note]);
  const s = STATUS[n.status] || STATUS.draft;
  const editable = canApprove && n.status === 'draft';
  const save = async () => {
    if (text === n.note) return;
    setSaving(true);
    setErr('');
    try {
      await onSave(n.id, text);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <li className="bg-white rounded-2xl border border-cream-deep/70 p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {editable && <input type="checkbox" checked={selected} onChange={(e) => onSelect(n.id, e.target.checked)} className="w-4 h-4 accent-terracotta" aria-label={`Select note for ${n.student_name}`} />}
        <span className="font-medium text-ink">{n.student_name}</span>
        <span className="text-sm text-ink-soft">{n.class_name}</span>
        <span className="text-xs rounded-md bg-cream px-1.5 py-0.5 text-ink-soft">{LANG[n.language] || n.language}</span>
        <span className="text-xs text-ink-soft inline-flex items-center gap-1">
          {n.generated_by === 'ai' ? <><Sparkles className="w-3 h-3" /> AI draft</> : 'Template'}
          {n.edited && ' · edited'}
        </span>
        <span className={`ml-auto inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold ${s.chip}`}>{s.label}</span>
      </div>
      {editable ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={save} rows={3} maxLength={700} className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm" />
      ) : (
        <p className="text-sm text-ink whitespace-pre-line">{n.note}</p>
      )}
      {saving && <div className="text-xs text-ink-soft">Saving…</div>}
      {err && <div className="text-xs text-destructive">{err}</div>}
      {n.error && <div className="text-xs text-destructive">{n.error}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Facts facts={n.facts || {}} />
        {(n.approved_by_name || n.sent_at) && (
          <span className="text-xs text-ink-soft">
            {n.approved_by_name && `Approved by ${n.approved_by_name}`}
            {n.sent_at && ` · sent ${formatDateTime(n.sent_at)}`}
          </span>
        )}
      </div>
    </li>
  );
}

function Consent({ classes, canChange }) {
  const [classId, setClassId] = useState(classes[0]?.id || '');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!classId) return;
    apiRequest(`/api/ai-automation/notes/consent?class_id=${classId}`).then(setRows).catch((e) => setError(e.message));
  }, [classId]);
  useEffect(load, [load]);
  const set = async (ids, consent) => {
    try {
      await apiRequest('/api/ai-automation/notes/consent', { method: 'POST', body: { parent_ids: ids, consent } });
      load();
    } catch (e) {
      setError(e.message);
    }
  };
  const unknown = (rows || []).filter((r) => r.ai_notes_consent === 'unknown').map((r) => r.parent_id);
  return (
    <section className="space-y-3">
      <p className="text-sm text-ink-soft max-w-2xl">
        Record each parent's answer to "May the school send you a short AI-assisted weekly note about your child's learning?". Only mark Yes when the parent has actually agreed (e.g. on the consent form or by message). Parents who reply STOP on WhatsApp get no school messages at all.
      </p>
      <ErrorBanner message={error} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className="px-3 py-1.5 rounded-lg border border-cream-deep bg-white">
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {canChange && unknown.length > 0 && (
          <button
            onClick={() => window.confirm(`Mark ${unknown.length} parent(s) with no answer yet as having agreed? Only do this if they really did.`) && set(unknown, 'granted')}
            className="px-3 py-1.5 rounded-lg border border-cream-deep text-ink hover:bg-white"
          >
            All {unknown.length} without an answer agreed
          </button>
        )}
      </div>
      {!rows ? (
        <div className="text-sm text-ink-soft">Loading…</div>
      ) : (
        <ul className="bg-white rounded-2xl border border-cream-deep/70 divide-y divide-cream-deep/50 text-sm">
          {rows.map((r) => (
            <li key={r.parent_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-[12rem]">
                <div className="text-ink">{r.parent_name}</div>
                <div className="text-xs text-ink-soft">{r.children}{r.opt_in_status !== 'OPTED_IN' && ' · WhatsApp off'}</div>
              </div>
              <div className="flex gap-1">
                {[['granted', 'Agreed'], ['declined', 'Said no'], ['unknown', 'No answer']].map(([v, label]) => (
                  <button
                    key={v}
                    disabled={!canChange}
                    onClick={() => set([r.parent_id], v)}
                    className={`px-2.5 py-1 rounded-lg text-xs ${r.ai_notes_consent === v ? 'bg-terracotta/15 text-terracotta-deep font-medium' : 'text-ink-soft hover:bg-cream'} disabled:opacity-60`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </li>
          ))}
          {rows.length === 0 && <li className="px-4 py-3 text-ink-soft">No parents in this class.</li>}
        </ul>
      )}
    </section>
  );
}

function Settings({ onSaved }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    apiRequest('/api/ai-automation/settings').then(setForm).catch((e) => setError(e.message));
  }, []);
  if (!form) return error ? <ErrorBanner message={error} /> : null;
  const save = async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/api/ai-automation/settings', { method: 'PUT', body: form });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    }
  };
  const set = (k) => (e) => {
    setSaved(false);
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  };
  return (
    <form onSubmit={save} className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-4 text-sm">
      <ErrorBanner message={error} />
      <label className="flex items-start gap-2 text-ink">
        <input type="checkbox" checked={form.progress_notes_enabled} onChange={set('progress_notes_enabled')} className="w-4 h-4 mt-0.5 accent-terracotta" />
        <span>
          Write weekly notes to parents (Sunday night)
          <span className="block text-xs text-ink-soft">Needs the WhatsApp template <code>student_progress_note</code> approved by Meta. While this is on, the older class-level weekly summary is not sent, so parents get one weekly message.</span>
        </span>
      </label>
      <div className="grid sm:grid-cols-3 gap-4">
        <label className="block">
          <span className="text-ink-soft">Who approves</span>
          <select value={form.progress_notes_approver} onChange={set('progress_notes_approver')} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep">
            <option value="class_teacher">Class teacher (or principal)</option>
            <option value="principal">Principal / operator only</option>
          </select>
        </label>
        <label className="block">
          <span className="text-ink-soft">Consent</span>
          <select value={form.progress_notes_consent_mode} onChange={set('progress_notes_consent_mode')} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep">
            <option value="explicit">Only parents who agreed</option>
            <option value="opt_out">Everyone except those who said no</option>
          </select>
        </label>
        <label className="block">
          <span className="text-ink-soft">Language</span>
          <select value={form.progress_notes_language} onChange={set('progress_notes_language')} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep">
            <option value="parent">Each parent's language (Hindi / Punjabi / English)</option>
            <option value="en">English for everyone</option>
            <option value="hinglish">Hinglish for everyone</option>
          </select>
        </label>
      </div>
      {form.progress_notes_consent_mode === 'opt_out' && (
        <p className="text-xs text-ink-soft">Use "everyone except those who said no" only if your admission form or privacy policy already tells parents about AI-assisted learning notes.</p>
      )}
      <div className="flex items-center gap-3">
        <button className="px-4 py-2 rounded-lg bg-terracotta text-white font-medium hover:bg-terracotta-deep">Save</button>
        {saved && <span className="text-ink-soft">Saved.</span>}
      </div>
    </form>
  );
}

export default function ProgressNotes({ teacher = false }) {
  const [meta, setMeta] = useState(null);
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState('');
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('draft');
  const [selected, setSelected] = useState(new Set());
  const [tab, setTab] = useState('notes');
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadMeta = useCallback(() => apiRequest('/api/ai-automation/notes/classes').then(setMeta).catch((e) => setError(e.message)), []);
  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (period) qs.set('period', period);
      if (classId) qs.set('class_id', classId);
      if (status) qs.set('status', status);
      setData(await apiRequest(`/api/ai-automation/notes?${qs}`));
      setSelected(new Set());
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [period, classId, status]);
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);
  useEffect(() => {
    load();
  }, [load]);

  const drafts = useMemo(() => (data?.notes || []).filter((n) => n.status === 'draft'), [data]);
  const select = (id, on) => setSelected((prev) => {
    const next = new Set(prev);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
  const saveNote = async (id, note) => {
    await apiRequest(`/api/ai-automation/notes/${id}`, { method: 'PATCH', body: { note } });
    await load();
  };
  const decide = async (approve) => {
    setBusy(true);
    setMessage('');
    try {
      const out = await apiRequest(`/api/ai-automation/notes/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { ids: [...selected] } });
      setMessage(approve ? `${out.updated} note(s) approved — they go out ${out.will_send === 'now' ? 'in the next few minutes' : 'from 8 AM'}.` : `${out.updated} note(s) will not be sent.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const draftNow = async () => {
    setBusy(true);
    setMessage('');
    try {
      const out = await apiRequest('/api/ai-automation/notes/draft-now', { method: 'POST' });
      setMessage(out.skipped === 'disabled' ? 'Weekly notes are switched off — turn them on in Settings first.' : `${out.drafted} new draft(s) for ${out.period}. ${out.eligible ? `${out.no_activity || 0} student(s) had nothing recorded this week.` : 'No parents with WhatsApp on and consent recorded yet — see the Consent tab.'}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const canApprove = data?.can_approve;
  const body = (
    <div className="space-y-6">
      <PageTitle
        title="Parent notes"
        subtitle="A short weekly note to each parent about their child's learning, written from the week's attendance, homework, results and AI tutor notes. Read, edit if needed, and approve — nothing is sent without approval."
        right={
          !teacher && (
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={draftNow} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cream-deep text-sm text-ink hover:bg-white disabled:opacity-50">
                <Wand2 className="w-4 h-4" /> Draft this week now
              </button>
              <button onClick={() => setShowSettings((v) => !v)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cream-deep text-sm text-ink hover:bg-white">
                <Settings2 className="w-4 h-4" /> Settings
              </button>
            </div>
          )
        }
      />
      {!teacher && (showSettings || meta?.settings?.enabled === false) && (
        <Settings onSaved={() => { loadMeta(); }} />
      )}
      <ErrorBanner message={error} />
      {message && <div className="rounded-xl bg-joy-leaf/15 px-4 py-3 text-sm text-ink">{message}</div>}

      <nav className="flex gap-1 border-b border-cream-deep/70">
        {[['notes', 'Notes'], ['consent', 'Consent']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-terracotta text-terracotta-deep font-medium' : 'border-transparent text-ink-soft hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'consent' ? (
        meta?.classes?.length ? <Consent classes={meta.classes} canChange /> : <div className="text-sm text-ink-soft">{teacher ? 'Consent is recorded by the class teacher — you are not class teacher of any class.' : 'No classes yet.'}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {data?.periods?.length > 0 && (
              <select value={period || data.period || ''} onChange={(e) => setPeriod(e.target.value)} className="px-3 py-1.5 rounded-lg border border-cream-deep bg-white" aria-label="Week">
                {data.periods.map((p) => <option key={p.period} value={p.period}>{p.period} ({p.n})</option>)}
              </select>
            )}
            {meta?.classes?.length > 1 && (
              <select value={classId} onChange={(e) => setClassId(e.target.value)} className="px-3 py-1.5 rounded-lg border border-cream-deep bg-white" aria-label="Class">
                <option value="">All classes</option>
                {meta.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-1.5 rounded-lg border border-cream-deep bg-white" aria-label="Status">
              <option value="draft">Waiting for approval</option>
              <option value="">All</option>
              <option value="sent">Sent</option>
              <option value="failed">Not delivered</option>
            </select>
          </div>

          {canApprove && drafts.length > 0 && (
            <div className="sticky top-14 z-[5] flex flex-wrap items-center gap-2 rounded-xl bg-white/95 border border-cream-deep/70 px-4 py-2.5 text-sm">
              <label className="flex items-center gap-2 text-ink">
                <input type="checkbox" checked={selected.size === drafts.length} onChange={(e) => setSelected(e.target.checked ? new Set(drafts.map((d) => d.id)) : new Set())} className="w-4 h-4 accent-terracotta" />
                Select all {drafts.length}
              </label>
              <span className="text-ink-soft">{selected.size} selected</span>
              <div className="ml-auto flex gap-2">
                <button disabled={busy || !selected.size} onClick={() => decide(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-terracotta text-white font-medium hover:bg-terracotta-deep disabled:opacity-50">
                  <Check className="w-4 h-4" /> Approve & send
                </button>
                <button disabled={busy || !selected.size} onClick={() => decide(false)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-deep text-ink hover:bg-cream disabled:opacity-50">
                  <X className="w-4 h-4" /> Don't send
                </button>
              </div>
            </div>
          )}
          {data && !canApprove && drafts.length > 0 && <p className="text-xs text-ink-soft">At this school the principal approves parent notes. You can read them here.</p>}

          {!data ? (
            <div className="text-sm text-ink-soft">Loading…</div>
          ) : data.notes.length === 0 ? (
            <div className="bg-white rounded-2xl border border-cream-deep/70 px-5 py-6 text-sm text-ink-soft">
              {status === 'draft' ? 'No notes waiting for approval.' : 'No notes for this week.'}
            </div>
          ) : (
            <ul className="space-y-3">
              {data.notes.map((n) => (
                <NoteRow key={n.id} n={n} canApprove={canApprove} selected={selected.has(n.id)} onSelect={select} onSave={saveNote} />
              ))}
            </ul>
          )}
        </>
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

export function TeacherProgressNotes() {
  return <ProgressNotes teacher />;
}
