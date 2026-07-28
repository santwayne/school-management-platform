import React, { useEffect, useState } from 'react';
import { NotebookPen, Paperclip } from 'lucide-react';
import { apiRequest } from '../api';

export default function AdminLessonPlans() {
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [plans, setPlans] = useState(null);
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiRequest('/api/academics/classes').catch(() => []),
      apiRequest('/api/academics/subjects').catch(() => []),
      apiRequest('/api/academics/teachers').catch(() => []),
    ]).then(([c, s, t]) => {
      setClasses(c);
      setSubjects(s);
      setTeachers(t);
    });
  }, []);

  const load = async () => {
    setError('');
    try {
      const params = new URLSearchParams();
      if (classId) params.set('class_id', classId);
      if (subjectId) params.set('subject_id', subjectId);
      if (teacherId) params.set('teacher_id', teacherId);
      const qs = params.toString();
      const data = await apiRequest(`/api/lesson-plans${qs ? `?${qs}` : ''}`);
      setPlans(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, subjectId, teacherId]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl text-ink flex items-center gap-2">
          <NotebookPen className="w-7 h-7 text-terracotta" /> Lesson Plans
        </h1>
        <p className="text-sm text-ink-soft mt-1">Every lesson plan submitted by teachers across the school.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className="rounded-lg border border-cream-deep/70 px-3 py-2 text-sm text-ink bg-white">
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="rounded-lg border border-cream-deep/70 px-3 py-2 text-sm text-ink bg-white">
          <option value="">All subjects</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="rounded-lg border border-cream-deep/70 px-3 py-2 text-sm text-ink bg-white">
          <option value="">All teachers</option>
          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="bg-white border border-cream-deep/70 rounded-2xl overflow-hidden">
        <table className="w-full text-left text-sm text-ink-soft">
          <thead className="bg-cream-deep/40 text-xs font-semibold text-ink-soft uppercase">
            <tr>
              <th className="p-3">Title</th>
              <th className="p-3">Class</th>
              <th className="p-3">Subject</th>
              <th className="p-3">Teacher</th>
              <th className="p-3">Date</th>
              <th className="p-3 text-right">Attachment</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {plans === null ? (
              <tr><td className="p-4 text-center" colSpan={6}>Loading…</td></tr>
            ) : plans.length === 0 ? (
              <tr><td className="p-4 text-center" colSpan={6}>No lesson plans found.</td></tr>
            ) : (
              plans.map((p) => (
                <tr key={p.id}>
                  <td className="p-3">
                    <div className="font-medium text-ink">{p.title}</div>
                    {p.content && <div className="text-xs text-ink-soft mt-0.5 line-clamp-2 max-w-md">{p.content}</div>}
                  </td>
                  <td className="p-3">{p.class_name}</td>
                  <td className="p-3">{p.subject_name || '—'}</td>
                  <td className="p-3">{p.teacher_name}</td>
                  <td className="p-3">{p.plan_date ? new Date(p.plan_date).toLocaleDateString('en-IN') : '—'}</td>
                  <td className="p-3 text-right">
                    {p.attachment_url ? (
                      <a
                        href={p.attachment_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-terracotta/15 text-terracotta-deep font-medium"
                      >
                        <Paperclip className="w-3 h-3" /> View
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
