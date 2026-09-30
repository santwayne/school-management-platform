import React, { useEffect, useState } from 'react';
import { AlertTriangle, Merge, UserPlus, RefreshCw } from 'lucide-react';
import { apiRequest } from '../../api';

function Card({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-ink-soft mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function DuplicateClassesCard({ error, setError, setMessage }) {
  const [groups, setGroups] = useState(null);
  const [merging, setMerging] = useState(null);

  const load = async () => {
    try {
      setGroups(await apiRequest('/api/academics/classes/duplicates'));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const merge = async (keepId, dupId, dupLabel) => {
    if (!window.confirm(`Merge "${dupLabel}" into the class you kept? This moves its students over and deletes the duplicate row.`)) return;
    setError('');
    setMerging(dupId);
    try {
      await apiRequest('/api/academics/classes/merge', {
        method: 'POST',
        body: { keep_class_id: keepId, duplicate_class_id: dupId },
      });
      setMessage('Duplicate class merged.');
      load();
    } catch (err) {
      // The backend's blocking-tables breakdown is folded into err.message
      // itself (apiRequest only preserves the top-level `error` string), so
      // no separate handling is needed here.
      setError(err.message);
    } finally {
      setMerging(null);
    }
  };

  if (groups === null) return <p className="text-sm text-ink-soft">Loading…</p>;
  if (groups.length === 0) {
    return <p className="text-sm text-ink-soft">No duplicate class names found.</p>;
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.name_key} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <div className="text-sm font-medium text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> "{g.classes[0].name}" appears {g.classes.length} times
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-ink-soft">
                <th className="py-1">Class</th>
                <th className="py-1">Students</th>
                <th className="py-1">Subject assignments</th>
                <th className="py-1 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-500/20">
              {g.classes.map((c) => {
                // Whichever row has more students is the sensible default
                // "keep" target — every OTHER row in the group can merge
                // into it one at a time.
                const keepCandidate = g.classes.reduce((a, b) => (b.student_count > a.student_count ? b : a));
                const isKeep = c.id === keepCandidate.id;
                return (
                  <tr key={c.id}>
                    <td className="py-1.5">
                      Class #{c.id} {isKeep && <span className="text-emerald-700 text-xs font-medium">(keep)</span>}
                    </td>
                    <td className="py-1.5">{c.student_count}</td>
                    <td className="py-1.5">{c.subject_assignment_count}</td>
                    <td className="py-1.5 text-right">
                      {!isKeep && (
                        <button
                          onClick={() => merge(keepCandidate.id, c.id, `Class #${c.id}`)}
                          disabled={merging === c.id}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border border-amber-500/40 text-amber-800 bg-white hover:bg-amber-500/10 disabled:opacity-50"
                        >
                          <Merge className="w-3.5 h-3.5" /> {merging === c.id ? 'Merging…' : `Merge into #${keepCandidate.id}`}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-ink-soft">
            A merge is refused if the duplicate has homework, exams, a fee structure, timetable entries, or other
            real data attached — only empty duplicates merge automatically.
          </p>
        </div>
      ))}
    </div>
  );
}

function NoParentCard({ error, setError, setMessage }) {
  const [students, setStudents] = useState(null);
  const [inputs, setInputs] = useState({});
  const [linking, setLinking] = useState(null);

  const load = async () => {
    try {
      setStudents(await apiRequest('/api/academics/students/no-parent'));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const link = async (studentId) => {
    const phone = (inputs[studentId]?.phone || '').trim();
    const name = (inputs[studentId]?.name || '').trim();
    if (!phone) {
      setError('Enter a parent phone number first.');
      return;
    }
    setError('');
    setLinking(studentId);
    try {
      await apiRequest(`/api/academics/students/${studentId}/link-parent`, {
        method: 'POST',
        body: { phone, name: name || undefined },
      });
      setMessage('Parent linked.');
      setStudents((prev) => prev.filter((s) => s.id !== studentId));
    } catch (err) {
      setError(err.message);
    } finally {
      setLinking(null);
    }
  };

  if (students === null) return <p className="text-sm text-ink-soft">Loading…</p>;
  if (students.length === 0) {
    return <p className="text-sm text-ink-soft">Every student has a parent linked.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-ink-soft border-b">
          <th className="py-2">Student</th>
          <th className="py-2">Class</th>
          <th className="py-2">Login ID</th>
          <th className="py-2">Parent name (optional)</th>
          <th className="py-2">Parent phone</th>
          <th className="py-2 text-right">Link</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {students.map((s) => (
          <tr key={s.id}>
            <td className="py-1.5 font-medium">{s.name}</td>
            <td className="py-1.5 text-ink-soft">{s.class_name || '—'}</td>
            <td className="py-1.5 font-mono text-xs">{s.login_id}</td>
            <td className="py-1.5">
              <input
                type="text"
                placeholder="Full name"
                value={inputs[s.id]?.name || ''}
                onChange={(e) => setInputs((prev) => ({ ...prev, [s.id]: { ...prev[s.id], name: e.target.value } }))}
                className="w-full p-1.5 border text-xs rounded"
              />
            </td>
            <td className="py-1.5">
              <input
                type="text"
                placeholder="+91..."
                value={inputs[s.id]?.phone || ''}
                onChange={(e) => setInputs((prev) => ({ ...prev, [s.id]: { ...prev[s.id], phone: e.target.value } }))}
                className="w-full p-1.5 border text-xs rounded"
              />
            </td>
            <td className="py-1.5 text-right">
              <button
                onClick={() => link(s.id)}
                disabled={linking === s.id}
                className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-terracotta text-white hover:bg-terracotta-deep disabled:opacity-50"
              >
                <UserPlus className="w-3.5 h-3.5" /> {linking === s.id ? 'Linking…' : 'Link'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function DataCleanupTab() {
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Data Cleanup</h1>
          <p className="text-sm text-ink-soft mt-1">Fix pre-existing data issues — duplicate classes and students with no parent linked.</p>
        </div>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-cream-deep bg-white hover:bg-cream-deep/40"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {message && <div className="p-3 bg-green-100 text-green-700 text-sm rounded">{message}</div>}
      {error && <div className="p-3 bg-red-100 text-destructive text-sm rounded">{error}</div>}

      <Card title="Duplicate classes" subtitle="Classes that share the exact same name">
        <DuplicateClassesCard key={`dup-${refreshKey}`} error={error} setError={setError} setMessage={setMessage} />
      </Card>

      <Card title="Students with no parent linked" subtitle="They miss every WhatsApp attendance/fee/note notification silently">
        <NoParentCard key={`noparent-${refreshKey}`} error={error} setError={setError} setMessage={setMessage} />
      </Card>
    </div>
  );
}
