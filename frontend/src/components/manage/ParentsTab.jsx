import React, { useEffect, useState } from 'react';
import { Search, Plus, Pencil, Trash2, X } from 'lucide-react';
import { apiRequest } from '../../api';

const LANGUAGES = [
  { value: 'hi', label: 'Hindi' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'en', label: 'English' },
];

export default function ParentsTab() {
  const [parents, setParents] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', preferred_language: 'hi' });

  const load = async (q = '') => {
    setLoading(true);
    try {
      setParents(await apiRequest(`/api/academics/parents${q ? `?search=${encodeURIComponent(q)}` : ''}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openAdd = () => {
    setForm({ name: '', phone: '', preferred_language: 'hi' });
    setModal('add');
  };
  const openEdit = (p) => {
    setForm({ name: p.name, phone: p.phone, preferred_language: p.preferred_language || 'hi' });
    setModal(p);
  };

  const save = async () => {
    setError('');
    try {
      if (modal === 'add') {
        await apiRequest('/api/academics/parents', { method: 'POST', body: form });
      } else {
        await apiRequest(`/api/academics/parents/${modal.id}`, { method: 'PATCH', body: form });
      }
      setModal(null);
      load(search);
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Remove this parent record?')) return;
    try {
      await apiRequest(`/api/academics/parents/${id}`, { method: 'DELETE' });
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
            placeholder="Search parents…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
          />
        </div>
        <button onClick={openAdd} className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition">
          <Plus className="w-4 h-4" /> Add parent
        </button>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Name</th>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Phone</th>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Children</th>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">WhatsApp</th>
                <th className="px-4 py-3 bg-cream-deep/40" />
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-deep/60">
              {loading ? (
                <tr><td className="px-4 py-4 text-ink-soft" colSpan={5}>Loading…</td></tr>
              ) : parents.length === 0 ? (
                <tr><td className="px-4 py-4 text-ink-soft" colSpan={5}>No parents found.</td></tr>
              ) : (
                parents.map((p) => (
                  <tr key={p.id} className="hover:bg-cream-deep/20">
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3 text-ink-soft">{p.phone}</td>
                    <td className="px-4 py-3 text-ink-soft">{p.child_count}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        p.opt_in_status === 'OPTED_IN' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-cream-deep text-ink-soft'
                      }`}>
                        {p.opt_in_status === 'OPTED_IN' ? 'Opted in' : 'Not opted in'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(p)} className="p-1.5 text-ink-soft hover:text-terracotta-deep"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(p.id)} className="p-1.5 text-ink-soft hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
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
              <h3 className="font-display text-lg text-ink">{modal === 'add' ? 'Add parent' : 'Edit parent'}</h3>
              <button onClick={() => setModal(null)}><X className="w-4 h-4 text-ink-soft" /></button>
            </div>
            <div className="space-y-3">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm" />
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="WhatsApp number" className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm" />
              <select value={form.preferred_language} onChange={(e) => setForm({ ...form, preferred_language: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm">
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
              <button onClick={save} className="w-full py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition">
                {modal === 'add' ? 'Add parent' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
