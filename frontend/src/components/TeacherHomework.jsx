import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpenCheck, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';

const EMPTY_FORM = { class_id: '', subject_id: '', title: '', description: '', due_date: '' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' -> '8 Oct'. Read as plain text on purpose: building a Date
// from it would shift the day for anyone outside the school's timezone.
function shortDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '';
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TeacherHomework() {
  const { user } = useAuth();
  const [options, setOptions] = useState([]);
  const [items, setItems] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const [o, h] = await Promise.all([apiRequest('/api/homework/options'), apiRequest('/api/homework')]);
      setOptions(o);
      setItems(h);
    } catch (err) {
      setError(err.message);
      setItems((prev) => prev || []);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const classOptions = useMemo(() => {
    const seen = new Map();
    for (const o of options) if (!seen.has(o.class_id)) seen.set(o.class_id, o.class_name);
    return Array.from(seen, ([class_id, class_name]) => ({ class_id, class_name }));
  }, [options]);

  const subjectsForClass = options.filter((o) => String(o.class_id) === String(form.class_id));

  const pickClass = (classId) => {
    const subjects = options.filter((o) => String(o.class_id) === String(classId));
    // A teacher usually has one subject per class, so it is filled in for them.
    setForm({ ...form, class_id: classId, subject_id: subjects.length === 1 ? String(subjects[0].subject_id) : '' });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSubmitting(true);
    try {
      const created = await apiRequest('/api/homework', {
        method: 'POST',
        body: {
          class_id: Number(form.class_id),
          subject_id: Number(form.subject_id),
          title: form.title,
          description: form.description,
          due_date: form.due_date || null,
        },
      });
      setForm(EMPTY_FORM);
      setMessage(`Homework assigned to ${created.class_name}. Students can see it now and parents are being messaged.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (h) => {
    if (!window.confirm(`Remove "${h.title}" for ${h.class_name}? Students will no longer see it. Parents who were already messaged are not told.`)) return;
    setError('');
    setMessage('');
    try {
      await apiRequest(`/api/homework/${h.id}`, { method: 'DELETE' });
      setMessage('Homework removed.');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const noClasses = items !== null && options.length === 0;

  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <header className="sticky top-0 z-10 bg-cream/85 backdrop-blur-md border-b border-cream-deep/70">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link to={user?.role === 'principal' ? '/dashboard' : '/teacher'} className="p-2 -ml-2 rounded-lg hover:bg-cream-deep/60 transition" aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-ink-soft" />
          </Link>
          <h1 className="font-display text-lg text-ink">Homework</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {message && <div role="status" className="rounded-lg bg-green-100 text-green-700 text-sm px-3 py-2">{message}</div>}
        {error && <div role="alert" className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm px-3 py-2">{error}</div>}

        {noClasses ? (
          <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 text-sm text-ink-soft">
            You are not assigned to any class and subject yet, so there is nobody to give homework to. The principal assigns
            teachers to classes under Manage School.
          </div>
        ) : (
          <form onSubmit={handleCreate} className="rounded-2xl bg-white border border-cream-deep/70 p-5 space-y-3">
            <div className="font-display text-base text-ink flex items-center gap-2">
              <BookOpenCheck className="w-4 h-4 text-terracotta" /> Assign homework
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-ink-soft space-y-1">
                Class
                <select
                  value={form.class_id}
                  onChange={(e) => pickClass(e.target.value)}
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
                  required
                  disabled={!form.class_id}
                  className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink bg-white disabled:opacity-50"
                >
                  <option value="">Select subject</option>
                  {subjectsForClass.map((s) => <option key={s.subject_id} value={s.subject_id}>{s.subject_name}</option>)}
                </select>
              </label>
            </div>

            <label className="text-sm text-ink-soft space-y-1 block">
              What to do
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                maxLength={255}
                placeholder="e.g. Exercise 5.2, questions 1 to 10"
                className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
              />
            </label>

            <label className="text-sm text-ink-soft space-y-1 block">
              Details (optional)
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                maxLength={2000}
                className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
              />
            </label>

            <label className="text-sm text-ink-soft space-y-1 block sm:w-1/2">
              Due date (optional)
              <input
                type="date"
                value={form.due_date}
                min={todayLocal()}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
              />
            </label>

            <button
              disabled={submitting}
              className="w-full py-2 bg-terracotta hover:bg-terracotta-deep text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Assigning…' : 'Assign homework'}
            </button>
            <p className="text-xs text-ink-soft">
              Every student in the class sees it in their portal, and each parent gets a WhatsApp message with the subject, what
              to do and the due date.
            </p>
          </form>
        )}

        <div className="space-y-3">
          <div className="font-display text-base text-ink">{user?.role === 'principal' ? 'Homework across the school' : 'Homework you assigned'}</div>
          {items === null ? (
            <div className="text-sm text-ink-soft">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-ink-soft">Nothing assigned yet.</div>
          ) : (
            <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
              {items.map((h) => (
                <div key={h.id} className="p-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="font-medium text-ink break-words">{h.title}</div>
                    <div className="text-xs text-ink-soft">
                      {h.class_name}, {h.subject_name}
                      {user?.role === 'principal' && h.created_by_name ? `, by ${h.created_by_name}` : ''}
                    </div>
                    {h.description && <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-line break-words">{h.description}</p>}
                    <div className="text-xs text-ink-soft flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                      <span>{h.due_date ? `Due ${shortDate(h.due_date)}` : 'No due date'}</span>
                      <span>{h.done_count} of {h.student_count} students marked it done</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(h)}
                    className="p-2 -mr-1 rounded-lg text-ink-soft hover:bg-destructive/10 hover:text-destructive transition shrink-0"
                    aria-label={`Remove ${h.title}`}
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
