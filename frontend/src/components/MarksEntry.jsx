import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X, Save, ClipboardEdit } from 'lucide-react';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function selectCls() {
  return 'w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40';
}

export default function MarksEntry() {
  const { user } = useAuth();
  const isPrincipal = user?.role === 'principal';

  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [myClasses, setMyClasses] = useState([]); // teacher's own class_id-subject_id assignments
  const [exams, setExams] = useState([]);

  const [classId, setClassId] = useState('');
  const [examId, setExamId] = useState('');
  const [subjectId, setSubjectId] = useState('');

  const [grid, setGrid] = useState(null); // { exam, students }
  const [maxMarks, setMaxMarks] = useState(100);
  const [rowValues, setRowValues] = useState({}); // student_id -> marks_obtained string

  const [newExamOpen, setNewExamOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gridLoading, setGridLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Classes a teacher may pick from (all classes for principal, only their
  // own assigned classes otherwise) — mirrors the class_subject_teachers
  // restriction used across the rest of the app (see classNotes.js).
  const availableClasses = useMemo(() => {
    if (isPrincipal) return classes;
    const ids = new Set(myClasses.map((c) => c.class_id));
    return classes.filter((c) => ids.has(c.id));
  }, [classes, myClasses, isPrincipal]);

  // Subjects available for the selected class — all subjects for principal,
  // only the teacher's own assignments for that class otherwise.
  const availableSubjects = useMemo(() => {
    if (!classId) return [];
    if (isPrincipal) return subjects;
    const ids = new Set(myClasses.filter((c) => String(c.class_id) === String(classId)).map((c) => c.subject_id));
    return subjects.filter((s) => ids.has(s.id));
  }, [subjects, myClasses, classId, isPrincipal]);

  const examsForClass = useMemo(() => exams.filter((e) => String(e.class_id) === String(classId)), [exams, classId]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [c, s, ex] = await Promise.all([
          apiRequest('/api/academics/classes'),
          apiRequest('/api/academics/subjects'),
          apiRequest('/api/exams'),
        ]);
        setClasses(c);
        setSubjects(s);
        setExams(ex);
        if (!isPrincipal) {
          const mine = await apiRequest('/api/academics/my-classes');
          setMyClasses(mine);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isPrincipal]);

  useEffect(() => {
    setExamId('');
    setSubjectId('');
    setGrid(null);
  }, [classId]);

  useEffect(() => {
    setGrid(null);
  }, [examId, subjectId]);

  const loadGrid = async () => {
    if (!examId || !subjectId) return;
    setGridLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await apiRequest(`/api/exams/${examId}/marks?subject_id=${subjectId}`);
      setGrid(data);
      const existingMax = data.students.find((s) => s.max_marks)?.max_marks;
      setMaxMarks(existingMax ? Number(existingMax) : 100);
      setRowValues(
        Object.fromEntries(data.students.map((s) => [s.student_id, s.marks_obtained ?? '']))
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setGridLoading(false);
    }
  };

  useEffect(() => {
    if (examId && subjectId) loadGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, subjectId]);

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const marks = Object.entries(rowValues)
        .filter(([, v]) => v !== '' && v !== null && v !== undefined)
        .map(([student_id, marks_obtained]) => ({
          student_id: Number(student_id),
          marks_obtained: Number(marks_obtained),
          max_marks: Number(maxMarks) || 100,
        }));
      const res = await apiRequest(`/api/exams/${examId}/marks`, {
        method: 'POST',
        body: { subject_id: Number(subjectId), marks },
      });
      setMessage(`Saved marks for ${res.saved_count} student${res.saved_count === 1 ? '' : 's'}.`);
      setTimeout(() => setMessage(''), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-ink-soft">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl text-ink">Marks Entry</h1>
          <p className="text-sm text-ink-soft mt-1">Enter subject-wise marks per student for an exam or term.</p>
        </div>
        {isPrincipal && (
          <button
            onClick={() => setNewExamOpen(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition"
          >
            <Plus className="w-4 h-4" /> New exam
          </button>
        )}
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {message && <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-700">{message}</div>}

      <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Class">
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className={selectCls()}>
              <option value="">Select class</option>
              {availableClasses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Exam">
            <select value={examId} onChange={(e) => setExamId(e.target.value)} disabled={!classId} className={selectCls()}>
              <option value="">Select exam</option>
              {examsForClass.map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.term ? ` · ${e.term}` : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Subject">
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!classId} className={selectCls()}>
              <option value="">Select subject</option>
              {availableSubjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
        </div>
        {classId && examsForClass.length === 0 && (
          <p className="text-xs text-ink-soft">No exams set up for this class yet{isPrincipal ? ' — create one above.' : '.'}</p>
        )}
        {classId && !isPrincipal && availableSubjects.length === 0 && (
          <p className="text-xs text-ink-soft">You aren't assigned to any subject in this class.</p>
        )}
      </div>

      {gridLoading && <p className="text-sm text-ink-soft">Loading roster…</p>}

      {grid && !gridLoading && (
        <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
          <div className="flex items-center justify-between gap-4 flex-wrap px-5 py-4 border-b border-cream-deep/70">
            <div>
              <div className="font-display text-lg text-ink">{grid.exam.name}{grid.exam.term ? ` · ${grid.exam.term}` : ''}</div>
              <div className="text-xs text-ink-soft">{grid.students.length} students</div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs font-medium text-ink-soft">Max marks</span>
              <input
                type="number"
                min="1"
                value={maxMarks}
                onChange={(e) => setMaxMarks(e.target.value)}
                className="w-20 px-2 py-1.5 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
              />
            </label>
          </div>
          {grid.students.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-soft">No students in this class yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Student</th>
                    <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Marks obtained</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-deep/60">
                  {grid.students.map((s, i) => (
                    <tr key={s.student_id} className="hover:bg-cream-deep/20">
                      <td className="px-4 py-2.5 align-middle">
                        <span className="text-ink-soft/60 text-xs mr-2">{i + 1}.</span>
                        {s.student_name}
                      </td>
                      <td className="px-4 py-2.5 align-middle">
                        <input
                          type="number"
                          min="0"
                          max={maxMarks || undefined}
                          step="0.5"
                          value={rowValues[s.student_id] ?? ''}
                          onChange={(e) => setRowValues((prev) => ({ ...prev, [s.student_id]: e.target.value }))}
                          className="w-24 px-2 py-1.5 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
                          placeholder="—"
                        />
                        <span className="text-xs text-ink-soft ml-2">/ {maxMarks || 100}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-5 py-4 border-t border-cream-deep/70 flex justify-end">
            <button
              onClick={save}
              disabled={saving || grid.students.length === 0}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save marks'}
            </button>
          </div>
        </div>
      )}

      {!grid && !gridLoading && classId && examId && subjectId === '' && (
        <div className="flex flex-col items-center py-12 text-center text-ink-soft">
          <ClipboardEdit className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-sm">Pick a subject to load the marks grid.</p>
        </div>
      )}

      {newExamOpen && (
        <NewExamModal
          classes={classes}
          defaultClassId={classId}
          onClose={() => setNewExamOpen(false)}
          onSave={async (form) => {
            setError('');
            try {
              const exam = await apiRequest('/api/exams', { method: 'POST', body: form });
              setExams((prev) => [exam, ...prev]);
              setNewExamOpen(false);
            } catch (err) {
              setError(err.message);
            }
          }}
        />
      )}
    </div>
  );
}

function NewExamModal({ classes, defaultClassId, onClose, onSave }) {
  const [name, setName] = useState('');
  const [term, setTerm] = useState('');
  const [classId, setClassId] = useState(defaultClassId || '');
  const valid = name.trim() && classId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-cream rounded-2xl border border-cream-deep w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-cream-deep/70">
          <h3 className="font-display text-lg text-ink inline-flex items-center gap-2">
            <ClipboardEdit className="w-5 h-5 text-terracotta" /> New exam
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-cream-deep/60 text-ink-soft">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Exam name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mid-Term 2026"
              className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
            />
          </Field>
          <Field label="Term (optional)">
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="e.g. Term 1"
              className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
            />
          </Field>
          <Field label="Class">
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className={selectCls()}>
              <option value="">Select class</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="px-5 py-4 border-t border-cream-deep/70 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg text-ink-soft hover:bg-cream-deep/60">
            Cancel
          </button>
          <button
            disabled={!valid}
            onClick={() => onSave({ name: name.trim(), term: term.trim() || undefined, class_id: Number(classId) })}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
