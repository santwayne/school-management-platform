import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, NotebookPen, Paperclip } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api';

const EMPTY_FORM = { class_id: '', subject_id: '', title: '', content: '', attachment_url: '', timetable_slot_id: '', plan_date: '' };

export default function TeacherLessonPlans() {
  const [myClasses, setMyClasses] = useState([]);
  const [plans, setPlans] = useState(null);
  const [slots, setSlots] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [filterClassId, setFilterClassId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const [c, p] = await Promise.all([
        apiRequest('/api/academics/my-classes'),
        apiRequest('/api/lesson-plans'),
      ]);
      setMyClasses(c);
      setPlans(p);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Distinct classes this teacher is assigned to, plus the subjects taught
  // in whichever class is currently selected in the create form.
  const classOptions = useMemo(() => {
    const seen = new Map();
    for (const c of myClasses) if (!seen.has(c.class_id)) seen.set(c.class_id, c.class_name);
    return Array.from(seen, ([class_id, class_name]) => ({ class_id, class_name }));
  }, [myClasses]);

  const subjectsForClass = (classId) => myClasses.filter((c) => String(c.class_id) === String(classId));

  useEffect(() => {
    if (!form.class_id) {
      setSlots([]);
      return;
    }
    apiRequest(`/api/timetable/class/${form.class_id}`)
      .then(setSlots)
      .catch(() => setSlots([]));
  }, [form.class_id]);

  const filteredPlans = (plans || []).filter((p) => {
    if (filterClassId && String(p.class_id) !== String(filterClassId)) return false;
    if (filterSubjectId && String(p.subject_id) !== String(filterSubjectId)) return false;
    return true;
  });

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSubmitting(true);
    try {
      await apiRequest('/api/lesson-plans', {
        method: 'POST',
        body: {
          ...form,
          subject_id: form.subject_id || null,
          timetable_slot_id: form.timetable_slot_id || null,
          plan_date: form.plan_date || null,
        },
      });
      setForm(EMPTY_FORM);
      setMessage('Lesson plan saved.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <header className="sticky top-0 z-10 bg-cream/85 backdrop-blur-md border-b border-cream-deep/70">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link to="/teacher" className="p-2 -ml-2 rounded-lg hover:bg-cream-deep/60 transition" aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-ink-soft" />
          </Link>
          <h1 className="font-display text-lg text-ink">Lesson Plans</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {message && <div className="rounded-lg bg-green-100 text-green-700 text-sm px-3 py-2">{message}</div>}
        {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm px-3 py-2">{error}</div>}

        <form onSubmit={handleCreate} className="rounded-2xl bg-white border border-cream-deep/70 p-5 space-y-3">
          <div className="font-display text-base text-ink flex items-center gap-2">
            <NotebookPen className="w-4 h-4 text-terracotta" /> New lesson plan
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-ink-soft space-y-1">
              Class
              <select
                value={form.class_id}
                onChange={(e) => setForm({ ...form, class_id: e.target.value, subject_id: '', timetable_slot_id: '' })}
                required
                className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink bg-white"
              >
                <option value="">Select class</option>
                {classOptions.map((c) => <option key={c.class_id} value={c.class_id}>{c.class_name}</option>)}
              </select>
            </label>
            <label className="text-sm text-ink-soft space-y-1">
              Subject
              <select
                value={form.subject_id}
                onChange={(e) => setForm({ ...form, subject_id: e.target.value })}
                className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink bg-white"
              >
                <option value="">Subject (optional)</option>
                {subjectsForClass(form.class_id).map((s) => (
                  <option key={s.subject_id} value={s.subject_id}>{s.subject_name}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="text-sm text-ink-soft space-y-1 block">
            Title
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
            />
          </label>

          <label className="text-sm text-ink-soft space-y-1 block">
            Content / notes
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={4}
              className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
            />
          </label>

          <label className="text-sm text-ink-soft space-y-1 block">
            Attachment URL (optional)
            <input
              type="text"
              placeholder="e.g. PDF or slides link"
              value={form.attachment_url}
              onChange={(e) => setForm({ ...form, attachment_url: e.target.value })}
              className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-ink-soft space-y-1">
              Target date (optional)
              <input
                type="date"
                value={form.plan_date}
                onChange={(e) => setForm({ ...form, plan_date: e.target.value })}
                className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
              />
            </label>
            <label className="text-sm text-ink-soft space-y-1">
              Timetable slot (optional)
              <select
                value={form.timetable_slot_id}
                onChange={(e) => setForm({ ...form, timetable_slot_id: e.target.value })}
                disabled={!form.class_id}
                className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink bg-white disabled:opacity-50"
              >
                <option value="">— none —</option>
                {slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {DAYS[s.day_of_week - 1]} · P{s.period_number}{s.subject_name ? ` · ${s.subject_name}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            disabled={submitting}
            className="w-full py-2 bg-terracotta hover:bg-terracotta-deep text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save lesson plan'}
          </button>
        </form>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="font-display text-base text-ink">Your lesson plans</div>
            <div className="flex gap-2">
              <select
                value={filterClassId}
                onChange={(e) => setFilterClassId(e.target.value)}
                className="rounded-lg border border-cream-deep/70 px-2 py-1.5 text-xs text-ink bg-white"
              >
                <option value="">All classes</option>
                {classOptions.map((c) => <option key={c.class_id} value={c.class_id}>{c.class_name}</option>)}
              </select>
              <select
                value={filterSubjectId}
                onChange={(e) => setFilterSubjectId(e.target.value)}
                className="rounded-lg border border-cream-deep/70 px-2 py-1.5 text-xs text-ink bg-white"
              >
                <option value="">All subjects</option>
                {Array.from(new Map(myClasses.map((c) => [c.subject_id, c.subject_name])), ([subject_id, subject_name]) => (
                  <option key={subject_id} value={subject_id}>{subject_name}</option>
                ))}
              </select>
            </div>
          </div>

          {plans === null ? (
            <div className="text-sm text-ink-soft">Loading…</div>
          ) : filteredPlans.length === 0 ? (
            <div className="text-sm text-ink-soft">No lesson plans yet.</div>
          ) : (
            <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
              {filteredPlans.map((p) => (
                <div key={p.id} className="p-4 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-ink">{p.title}</div>
                    {p.plan_date && (
                      <span className="text-xs text-ink-soft shrink-0">{new Date(p.plan_date).toLocaleDateString('en-IN')}</span>
                    )}
                  </div>
                  <div className="text-xs text-ink-soft">
                    {p.class_name}{p.subject_name ? ` · ${p.subject_name}` : ''}
                  </div>
                  {p.content && <p className="text-sm text-ink-soft leading-relaxed">{p.content}</p>}
                  {p.attachment_url && (
                    <a
                      href={p.attachment_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-terracotta-deep font-medium hover:underline"
                    >
                      <Paperclip className="w-3 h-3" /> Attachment
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
