import React, { useEffect, useState } from 'react';
import { Search, Plus, Pencil, Trash2, X } from 'lucide-react';
import { apiRequest } from '../../api';

export default function TeachersTab() {
  const [teachers, setTeachers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // null | 'add' | teacher object being edited
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });

  const load = async () => {
    setLoading(true);
    try {
      setTeachers(await apiRequest('/api/academics/teachers'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openAdd = () => {
    setForm({ name: '', email: '', phone: '', password: '' });
    setModal('add');
  };
  const openEdit = (t) => {
    setForm({ name: t.name, email: t.email, phone: t.phone, password: '' });
    setModal(t);
  };

  const save = async () => {
    setError('');
    try {
      if (modal === 'add') {
        await apiRequest('/api/academics/teachers', { method: 'POST', body: form });
      } else {
        await apiRequest(`/api/academics/teachers/${modal.id}`, { method: 'PATCH', body: { name: form.name, phone: form.phone } });
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Remove this teacher? They will lose access immediately.')) return;
    try {
      await apiRequest(`/api/academics/teachers/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const filtered = teachers.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search teachers…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
          />
        </div>
        <button onClick={openAdd} className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition">
          <Plus className="w-4 h-4" /> Add teacher
        </button>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Name</th>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Email</th>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Phone</th>
                <th className="px-4 py-3 bg-cream-deep/40" />
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-deep/60">
              {loading ? (
                <tr><td className="px-4 py-4 text-ink-soft" colSpan={4}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="px-4 py-4 text-ink-soft" colSpan={4}>No teachers found.</td></tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-cream-deep/20">
                    <td className="px-4 py-3 font-medium">{t.name}</td>
                    <td className="px-4 py-3 text-ink-soft">{t.email}</td>
                    <td className="px-4 py-3 text-ink-soft">{t.phone}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(t)} className="p-1.5 text-ink-soft hover:text-terracotta-deep"><Pencil className="w-3.5 h-3.5" /></button>
                      {t.role !== 'principal' && (
                        <button onClick={() => remove(t.id)} className="p-1.5 text-ink-soft hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
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
              <h3 className="font-display text-lg text-ink">{modal === 'add' ? 'Add teacher' : 'Edit teacher'}</h3>
              <button onClick={() => setModal(null)}><X className="w-4 h-4 text-ink-soft" /></button>
            </div>
            <div className="space-y-3">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm" />
              {modal === 'add' && (
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm" />
              )}
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm" />
              {modal === 'add' && (
                <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} type="password" placeholder="Set a login password" className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm" />
              )}
              <button onClick={save} className="w-full py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition">
                {modal === 'add' ? 'Add teacher' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
