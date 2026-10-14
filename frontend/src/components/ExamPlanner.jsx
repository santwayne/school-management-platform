import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Plus, Trash2, Wand2, BookOpenCheck, NotebookPen, ClipboardCheck, RotateCcw } from 'lucide-react';
import { apiRequest } from '../api';

const ACTIVITY = {
  lesson_plan: { label: 'Lesson plan', icon: NotebookPen, tone: 'bg-sky-500/10 text-sky-700' },
  homework: { label: 'Homework', icon: BookOpenCheck, tone: 'bg-amber-500/15 text-amber-700' },
  test: { label: 'Test', icon: ClipboardCheck, tone: 'bg-terracotta/15 text-terracotta-deep' },
  revision: { label: 'Revision', icon: RotateCcw, tone: 'bg-emerald-500/10 text-emerald-700' },
};

const inputCls = 'w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40';

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export default function ExamPlanner() {
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState('');
  const [data, setData] = useState(null);
  const [subjectId, setSubjectId] = useState('');
  const [chapters, setChapters] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [examDate, setExamDate] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest('/api/exams').then(setExams).catch((err) => setError(err.message));
  }, []);

  const load = async (id = examId) => {
    if (!id) return setData(null);
    try {
      const d = await apiRequest(`/api/exam-plans/${id}`);
      setData(d);
      setExamDate(d.exam.exam_date || '');
      setSubjectId((prev) => (prev && d.subjects.some((s) => String(s.subject_id) === String(prev)) ? prev : String(d.subjects[0]?.subject_id || '')));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    setError('');
    setMessage('');
    load(examId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  // The editor shows the saved syllabus for the chosen subject.
  useEffect(() => {
    if (!data) return setChapters([]);
    setChapters(
      data.syllabus
        .filter((c) => String(c.subject_id) === String(subjectId))
        .map((c) => ({ chapter_name: c.chapter_name, topics: c.topics || '', weight: c.weight }))
    );
  }, [data, subjectId]);

  const update = (i, patch) => setChapters((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const run = async (fn, okMessage) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      if (okMessage) setMessage(okMessage);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveSyllabus = () =>
    run(async () => {
      await apiRequest(`/api/exam-plans/${examId}/syllabus`, { method: 'PUT', body: { subject_id: Number(subjectId), chapters } });
      await load();
    }, 'Syllabus saved.');

  const importCalendar = () =>
    run(async () => {
      const r = await apiRequest(`/api/exam-plans/${examId}/import-calendar`, { method: 'POST', body: { subject_id: Number(subjectId) } });
      if (!r.chapters.length) throw new Error('No chapters for this subject on the Syllabus page yet — add them below.');
      setChapters(r.chapters);
    }, 'Chapters loaded from the syllabus calendar — review and save.');

  const generate = (all) =>
    run(async () => {
      await apiRequest(`/api/exam-plans/${examId}/generate`, {
        method: 'POST',
        body: { start_date: startDate, exam_date: examDate, subject_id: all ? undefined : Number(subjectId) },
      });
      await load();
    }, 'Plan generated. Turn items into drafts below; nothing is sent to students until you share it.');

  const createDraft = (item) =>
    run(async () => {
      await apiRequest(`/api/exam-plans/items/${item.id}/create`, { method: 'POST' });
      await load();
    }, `Draft ${item.activity_type === 'homework' ? 'homework' : 'lesson plan'} created — find it under ${item.activity_type === 'homework' ? 'Homework' : 'Lesson Plans'}.`);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const p of data?.plan || []) {
      if (!map.has(p.planned_date)) map.set(p.planned_date, []);
      map.get(p.planned_date).push(p);
    }
    return [...map.entries()];
  }, [data]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-xl text-ink flex items-center gap-2"><CalendarRange className="w-5 h-5 text-terracotta" /> Exam planner</h1>
        <p className="text-sm text-ink-soft mt-1">
          Enter each exam's syllabus, then split it into a dated pattern of lesson plans, homework, chapter tests and revision.
        </p>
      </div>

      {message && <div role="status" className="rounded-lg bg-green-100 text-green-700 text-sm px-3 py-2">{message}</div>}
      {error && <div role="alert" className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm px-3 py-2">{error}</div>}

      <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 grid sm:grid-cols-2 gap-3">
        <label className="text-sm text-ink-soft space-y-1 block">
          Exam
          <select value={examId} onChange={(e) => setExamId(e.target.value)} className={inputCls}>
            <option value="">Select an exam</option>
            {exams.map((e) => <option key={e.id} value={e.id}>{e.class_name} — {e.name}{e.term ? ` (${e.term})` : ''}</option>)}
          </select>
        </label>
        {data && (
          <label className="text-sm text-ink-soft space-y-1 block">
            Subject
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className={inputCls}>
              {data.subjects.map((s) => <option key={s.subject_id} value={s.subject_id}>{s.subject_name}</option>)}
            </select>
          </label>
        )}
        {exams.length === 0 && <p className="text-sm text-ink-soft sm:col-span-2">No exams yet — the principal creates exams under Marks Entry.</p>}
        {data && data.subjects.length === 0 && <p className="text-sm text-ink-soft sm:col-span-2">You are not assigned to any subject in {data.exam.class_name}.</p>}
      </div>

      {data && data.subjects.length > 0 && (
        <>
          <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="font-display text-base text-ink">1. Syllabus</div>
              <button type="button" onClick={importCalendar} disabled={busy} className="text-xs text-terracotta-deep font-medium hover:underline disabled:opacity-50">
                Load chapters from the Syllabus page
              </button>
            </div>
            {chapters.length === 0 && <p className="text-sm text-ink-soft">No chapters yet for this subject.</p>}
            {chapters.map((c, i) => (
              <div key={i} className="rounded-xl border border-cream-deep/70 p-3 grid grid-cols-[1fr_auto_auto] gap-2 items-start">
                <input value={c.chapter_name} onChange={(e) => update(i, { chapter_name: e.target.value })} placeholder="Chapter name" maxLength={255} className={inputCls} />
                <label className="text-xs text-ink-soft">
                  Weight
                  <select value={c.weight} onChange={(e) => update(i, { weight: Number(e.target.value) })} className="ml-1 rounded-lg border border-cream-deep px-2 py-1.5 text-sm bg-white">
                    {[1, 2, 3, 4, 5].map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => setChapters((r) => r.filter((_, idx) => idx !== i))} className="p-2 text-ink-soft hover:text-destructive" aria-label="Remove chapter"><Trash2 className="w-4 h-4" /></button>
                <textarea value={c.topics} onChange={(e) => update(i, { topics: e.target.value })} rows={2} placeholder="Topics (optional)" className={`${inputCls} col-span-3`} />
              </div>
            ))}
            <div className="flex gap-2">
              <button type="button" onClick={() => setChapters((r) => [...r, { chapter_name: '', topics: '', weight: 1 }])} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-cream-deep text-sm text-ink hover:bg-cream-deep/40">
                <Plus className="w-4 h-4" /> Add chapter
              </button>
              <button type="button" onClick={saveSyllabus} disabled={busy} className="ml-auto px-4 py-1.5 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
                Save syllabus
              </button>
            </div>
            <p className="text-xs text-ink-soft">Weight decides how many days a chapter gets — a weight-2 chapter gets about twice the time of a weight-1 chapter.</p>
          </div>

          <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 space-y-3">
            <div className="font-display text-base text-ink">2. Generate the plan</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-sm text-ink-soft space-y-1 block">
                Start date
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
              </label>
              <label className="text-sm text-ink-soft space-y-1 block">
                Exam date
                <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} className={inputCls} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => generate(false)} disabled={busy || !startDate || !examDate} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
                <Wand2 className="w-4 h-4" /> Plan this subject
              </button>
              {data.subjects.length > 1 && (
                <button type="button" onClick={() => generate(true)} disabled={busy || !startDate || !examDate} className="px-4 py-2 rounded-lg border border-cream-deep text-sm text-ink hover:bg-cream-deep/40 disabled:opacity-50">
                  Plan all my subjects together
                </button>
              )}
            </div>
            <p className="text-xs text-ink-soft">
              Sundays are skipped. The last stretch before the exam is revision, and the final working day is a full-syllabus mock test.
              Re-generating replaces items that have no draft yet.
            </p>
          </div>

          <div className="space-y-3">
            <div className="font-display text-base text-ink">3. Plan</div>
            {byDate.length === 0 ? (
              <div className="text-sm text-ink-soft">No plan yet.</div>
            ) : (
              <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
                {byDate.map(([date, items]) => (
                  <div key={date} className="p-4 grid sm:grid-cols-[110px_1fr] gap-2">
                    <div className="text-sm font-medium text-ink">{fmtDate(date)}</div>
                    <div className="space-y-2">
                      {items.map((p) => {
                        const meta = ACTIVITY[p.activity_type] || ACTIVITY.revision;
                        const canDraft = p.activity_type === 'homework' || p.activity_type === 'lesson_plan';
                        const drafted = p.homework_id || p.lesson_plan_id;
                        return (
                          <div key={p.id} className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.tone}`}>
                              <meta.icon className="w-3 h-3" /> {meta.label}
                            </span>
                            <span className="text-sm text-ink min-w-0 break-words">{p.title}</span>
                            {canDraft && (drafted
                              ? <span className="text-xs text-ink-soft">Draft created</span>
                              : <button type="button" disabled={busy} onClick={() => createDraft(p)} className="text-xs text-terracotta-deep font-medium hover:underline disabled:opacity-50">Create draft</button>)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
