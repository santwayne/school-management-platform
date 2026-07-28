import React, { useEffect, useMemo, useState } from 'react';
import { ListChecks, Plus, Trash2, Users, UserCheck } from 'lucide-react';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';

export default function AdminOptionalSubjects() {
  const { user } = useAuth();
  const isPrincipal = user?.role === 'principal';

  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState(null);
  const [students, setStudents] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [newSubjectName, setNewSubjectName] = useState('');

  const [selectedClassName, setSelectedClassName] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [mode, setMode] = useState('all'); // 'all' | 'individual'
  const [selectedStudentIds, setSelectedStudentIds] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);

  const loadBase = async () => {
    setError('');
    try {
      const [subjectsData, classesData] = await Promise.all([
        apiRequest('/api/optional-subjects/subjects'),
        apiRequest('/api/optional-subjects/classes'),
      ]);
      setSubjects(subjectsData);
      setClasses(classesData);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadBase();
  }, []);

  // Group classes by name so the UI can offer a Class dropdown, then a
  // Section dropdown scoped to that class name (classes.section is free
  // text on the class row itself — see backend/models/schema.sql).
  const classGroups = useMemo(() => {
    const map = {};
    for (const c of classes) {
      if (!map[c.name]) map[c.name] = [];
      map[c.name].push(c);
    }
    return map;
  }, [classes]);

  const sectionOptions = selectedClassName ? classGroups[selectedClassName] || [] : [];

  const loadAssignments = async (classId) => {
    try {
      const qs = classId ? `?class_id=${classId}` : '';
      const data = await apiRequest(`/api/optional-subjects/assignments${qs}`);
      setAssignments(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    setAssignments(null);
    loadAssignments(selectedClassId);
    setSelectedStudentIds(new Set());
    if (selectedClassId) {
      apiRequest(`/api/optional-subjects/students?class_id=${selectedClassId}`)
        .then(setStudents)
        .catch((err) => setError(err.message));
    } else {
      setStudents([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  const addSubject = async (e) => {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    setError('');
    try {
      await apiRequest('/api/optional-subjects/subjects', { method: 'POST', body: { name: newSubjectName.trim() } });
      setNewSubjectName('');
      await loadBase();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleStudent = (id) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitAssignment = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!selectedClassId || !selectedSubjectId) {
      setError('Pick a class, section and subject first.');
      return;
    }
    if (mode === 'individual' && selectedStudentIds.size === 0) {
      setError('Select at least one student, or switch to "All students".');
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        class_id: selectedClassId,
        subject_id: selectedSubjectId,
        assign_all: mode === 'all',
        student_ids: mode === 'individual' ? Array.from(selectedStudentIds) : undefined,
      };
      const res = await apiRequest('/api/optional-subjects/assign', { method: 'POST', body });
      setMessage(`Assigned to ${res.assigned_count} of ${res.target_count} student(s).`);
      setSelectedStudentIds(new Set());
      await loadAssignments(selectedClassId);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const removeAssignment = async (id) => {
    setError('');
    try {
      await apiRequest(`/api/optional-subjects/assignments/${id}`, { method: 'DELETE' });
      await loadAssignments(selectedClassId);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl text-ink flex items-center gap-2">
          <ListChecks className="w-7 h-7 text-terracotta" /> Optional Subjects
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          Assign optional subjects to a whole class &amp; section, or to individual students.
        </p>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {message && <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-700">{message}</div>}

      {isPrincipal && (
        <form onSubmit={addSubject} className="rounded-2xl bg-white border border-cream-deep/70 p-5 flex items-end gap-3">
          <label className="text-sm text-ink-soft space-y-1 flex-1">
            Add an optional subject
            <input
              type="text"
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              placeholder="e.g. Sanskrit, Robotics, Music"
              className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
            />
          </label>
          <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep">
            <Plus className="w-4 h-4" /> Add
          </button>
        </form>
      )}

      <form onSubmit={submitAssignment} className="rounded-2xl bg-white border border-cream-deep/70 p-5 space-y-4">
        <div className="font-display text-base text-ink">Assign a subject</div>

        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-sm text-ink-soft space-y-1">
            Class
            <select
              value={selectedClassName}
              onChange={(e) => {
                const name = e.target.value;
                setSelectedClassName(name);
                const opts = classGroups[name] || [];
                setSelectedClassId(opts[0]?.id || '');
              }}
              className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink bg-white"
            >
              <option value="">Select class…</option>
              {Object.keys(classGroups).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-ink-soft space-y-1">
            Section
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              disabled={!selectedClassName}
              className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink bg-white disabled:opacity-50"
            >
              {sectionOptions.length === 0 && <option value="">—</option>}
              {sectionOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.section || '—'}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-ink-soft space-y-1">
            Subject
            <select
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink bg-white"
            >
              <option value="">Select subject…</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} />
            All students in this class &amp; section
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === 'individual'} onChange={() => setMode('individual')} />
            Select individual students
          </label>
        </div>

        {mode === 'individual' && (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-cream-deep/60 divide-y divide-cream-deep/40">
            {!selectedClassId ? (
              <div className="p-3 text-sm text-ink-soft">Pick a class &amp; section first.</div>
            ) : students.length === 0 ? (
              <div className="p-3 text-sm text-ink-soft">No students in this class.</div>
            ) : (
              students.map((s) => (
                <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm text-ink cursor-pointer hover:bg-cream-deep/20">
                  <input
                    type="checkbox"
                    checked={selectedStudentIds.has(s.id)}
                    onChange={() => toggleStudent(s.id)}
                  />
                  {s.name}
                  {s.admission_number && <span className="text-xs text-ink-soft">({s.admission_number})</span>}
                </label>
              ))
            )}
          </div>
        )}

        <button
          disabled={submitting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50"
        >
          <UserCheck className="w-4 h-4" /> {submitting ? 'Assigning…' : 'Assign'}
        </button>
      </form>

      <div className="space-y-2">
        <div className="font-display text-base text-ink flex items-center gap-2">
          <Users className="w-4 h-4 text-terracotta" /> Current assignments {selectedClassId ? '(this class)' : ''}
        </div>
        {assignments === null ? (
          <div className="text-sm text-ink-soft py-4 text-center">Loading…</div>
        ) : assignments.length === 0 ? (
          <div className="rounded-2xl bg-white border border-cream-deep/70 p-6 text-center text-sm text-ink-soft">
            No assignments yet.
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
            {assignments.map((a) => (
              <div key={a.id} className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0 text-sm">
                  <span className="font-medium text-ink">{a.student_name}</span>
                  <span className="text-ink-soft"> · {a.class_name}{a.section ? ` ${a.section}` : ''} · {a.subject_name}</span>
                </div>
                <button
                  onClick={() => removeAssignment(a.id)}
                  className="p-1.5 rounded-lg text-ink-soft hover:bg-destructive/10 hover:text-destructive transition"
                  aria-label="Remove assignment"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
