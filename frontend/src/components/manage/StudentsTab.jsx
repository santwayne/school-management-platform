import React, { useEffect, useState } from 'react';
import { Search, Pencil, Trash2, X } from 'lucide-react';
import { apiRequest } from '../../api';

// Observations logged by teachers for this student (feature 4.6) — shown
// read-only inside the existing edit-student modal, which is already where
// an admin looks a student up, rather than a brand new admin page.
function ObservationsList({ studentId }) {
  const [observations, setObservations] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest(`/api/student-records/observations/student/${studentId}`)
      .then(setObservations)
      .catch((err) => setError(err.message));
  }, [studentId]);

  return (
    <div className="mt-4 pt-4 border-t border-cream-deep/70">
      <div className="text-xs font-medium text-ink-soft uppercase tracking-wider mb-2">Teacher observations</div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {observations === null && !error ? (
        <p className="text-xs text-ink-soft">Loading…</p>
      ) : observations && observations.length === 0 ? (
        <p className="text-xs text-ink-soft">No observations logged yet.</p>
      ) : (
        <ul className="space-y-2 max-h-48 overflow-y-auto">
          {observations?.map((o) => (
            <li key={o.id} className="text-xs bg-cream-deep/30 rounded-lg px-3 py-2">
              <div className="text-ink">{o.note}</div>
              <div className="text-ink-soft mt-1">
                {o.teacher_name} · {new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                {!o.visible_to_student && ' · Private'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function StudentsTab() {
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [parents, setParents] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', class_id: '', parent_id: '' });

  const load = async (q = '') => {
    setLoading(true);
    try {
      const [s, c, p] = await Promise.all([
        apiRequest(`/api/academics/students${q ? `?search=${encodeURIComponent(q)}` : ''}`),
        apiRequest('/api/academics/classes'),
        apiRequest('/api/academics/parents'),
      ]);
      setStudents(s);
      setClasses(c);
      setParents(p);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openEdit = (s) => {
    setForm({ name: s.name, class_id: s.class_id || '', parent_id: s.parent_id || '' });
    setModal(s);
  };

  const save = async () => {
    setError('');
    try {
      await apiRequest(`/api/academics/students/${modal.id}`, {
        method: 'PATCH',
        body: { name: form.name, class_id: form.class_id || null, parent_id: form.parent_id || null },
      });
      setModal(null);
      load(search);
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Remove this student record?')) return;
    try {
      await apiRequest(`/api/academics/students/${id}`, { method: 'DELETE' });
      load(search);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
          />
        </div>
        <p className="text-xs text-ink-soft ml-auto">New students are added via bulk import on the Classes &amp; Sections tab.</p>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Name</th>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Class</th>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Login ID</th>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Parent</th>
                <th className="px-4 py-3 bg-cream-deep/40" />
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-deep/60">
              {loading ? (
                <tr><td className="px-4 py-4 text-ink-soft" colSpan={5}>Loading…</td></tr>
              ) : students.length === 0 ? (
                <tr><td className="px-4 py-4 text-ink-soft" colSpan={5}>No students found.</td></tr>
              ) : (
                students.map((s) => (
                  <tr key={s.id} className="hover:bg-cream-deep/20">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-ink-soft">{s.class_name || '—'}</td>
                    <td className="px-4 py-3 text-ink-soft font-mono text-xs">{s.login_id || '—'}</td>
                    <td className="px-4 py-3 text-ink-soft">{s.parent_name || '—'}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(s)} className="p-1.5 text-ink-soft hover:text-terracotta-deep"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(s.id)} className="p-1.5 text-ink-soft hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4" onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg text-ink">Edit student</h3>
              <button onClick={() => setModal(null)}><X className="w-4 h-4 text-ink-soft" /></button>
            </div>
            <div className="space-y-3">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm" />
              <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm">
                <option value="">No class</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm">
                <option value="">No parent linked</option>
                {parents.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.phone})</option>)}
              </select>
              <button onClick={save} className="w-full py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition">
                Save changes
              </button>
            </div>
            <ObservationsList studentId={modal.id} />
          </div>
        </div>
      )}
    </div>
  );
}
