import React, { useEffect, useState } from 'react';
import { BookOpen, Plus, X, Search, RotateCcw } from 'lucide-react';
import { apiRequest } from '../api';

const TABS = [
  { key: 'catalog', label: 'Catalog' },
  { key: 'issues', label: 'Issued Books' },
];

function AddBookForm({ onClose, onSaved }) {
  const [form, setForm] = useState({ title: '', author: '', isbn: '', category: '', total_copies: 1 });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.title) return setError('Title is required.');
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/library/books', { method: 'POST', body: { ...form, total_copies: Number(form.total_copies) || 1 } });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-display text-base text-ink">Add book</div>
          <button onClick={onClose}><X className="w-4 h-4 text-ink-soft" /></button>
        </div>
        {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs px-3 py-2">{error}</div>}
        <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
        <input placeholder="Author" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="ISBN" value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
          <input placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
        </div>
        <label className="text-sm text-ink-soft space-y-1 block">
          Copies
          <input type="number" min={1} value={form.total_copies} onChange={(e) => setForm({ ...form, total_copies: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
        </label>
        <button disabled={saving} onClick={save} className="w-full px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
          {saving ? 'Saving…' : 'Add to catalog'}
        </button>
      </div>
    </div>
  );
}

function IssueForm({ book, onClose, onSaved }) {
  const [holderType, setHolderType] = useState('student');
  const [holderId, setHolderId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest('/api/academics/students').then(setStudents).catch(() => {});
    apiRequest('/api/academics/teachers').then(setTeachers).catch(() => {});
  }, []);

  const save = async () => {
    if (!holderId || !dueDate) return setError('Pick a person and a due date.');
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/library/issue', {
        method: 'POST',
        body: {
          book_id: book.id,
          due_date: dueDate,
          student_id: holderType === 'student' ? holderId : null,
          teacher_id: holderType === 'staff' ? holderId : null,
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const options = holderType === 'student' ? students : teachers;

  return (
    <div className="fixed inset-0 z-30 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-display text-base text-ink">Issue "{book.title}"</div>
          <button onClick={onClose}><X className="w-4 h-4 text-ink-soft" /></button>
        </div>
        {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs px-3 py-2">{error}</div>}
        <div className="flex gap-2">
          {['student', 'staff'].map((t) => (
            <button key={t} onClick={() => { setHolderType(t); setHolderId(''); }} className={`px-3 py-1.5 rounded-lg text-sm border ${holderType === t ? 'bg-terracotta text-white border-terracotta' : 'border-cream-deep/70 text-ink-soft'}`}>
              {t === 'student' ? 'Student' : 'Staff'}
            </button>
          ))}
        </div>
        <select value={holderId} onChange={(e) => setHolderId(e.target.value)} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink">
          <option value="">— select —</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <label className="text-sm text-ink-soft space-y-1 block">
          Due date
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
        </label>
        <button disabled={saving} onClick={save} className="w-full px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
          {saving ? 'Issuing…' : 'Issue book'}
        </button>
      </div>
    </div>
  );
}

function CatalogTab() {
  const [books, setBooks] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [issuingBook, setIssuingBook] = useState(null);

  const load = async (query) => {
    setError('');
    try {
      const data = await apiRequest(`/api/library/books${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      setBooks(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(''); }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-ink-soft absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); load(e.target.value); }}
            placeholder="Search title, author or ISBN…"
            className="w-full rounded-lg border border-cream-deep/70 pl-9 pr-3 py-2 text-ink"
          />
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep whitespace-nowrap">
          <Plus className="w-4 h-4" /> Add book
        </button>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="rounded-2xl border border-cream-deep/70 bg-white divide-y divide-cream-deep/60 overflow-hidden">
        {books === null ? (
          <div className="text-sm text-ink-soft p-6 text-center">Loading…</div>
        ) : books.length === 0 ? (
          <div className="text-sm text-ink-soft p-6 text-center">No books in the catalog yet.</div>
        ) : books.map((b) => (
          <div key={b.id} className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium text-ink">{b.title}</div>
              <div className="text-xs text-ink-soft">{b.author || 'Unknown author'}{b.category ? ` · ${b.category}` : ''}</div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm text-ink-soft">{b.available_copies}/{b.total_copies} available</span>
              <button
                disabled={b.available_copies < 1}
                onClick={() => setIssuingBook(b)}
                className="px-3 py-1.5 rounded-lg bg-white border border-cream-deep text-ink text-sm font-medium hover:bg-cream-deep/40 disabled:opacity-40"
              >
                Issue
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAdd && <AddBookForm onClose={() => setShowAdd(false)} onSaved={() => load(q)} />}
      {issuingBook && <IssueForm book={issuingBook} onClose={() => setIssuingBook(null)} onSaved={() => load(q)} />}
    </div>
  );
}

function IssuesTab() {
  const [issues, setIssues] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const data = await apiRequest('/api/library/issues?status=ISSUED');
      setIssues(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, []);

  const returnBook = async (id) => {
    try {
      await apiRequest(`/api/library/issue/${id}/return`, { method: 'PUT', body: {} });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-3">
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      <div className="rounded-2xl border border-cream-deep/70 bg-white divide-y divide-cream-deep/60 overflow-hidden">
        {issues === null ? (
          <div className="text-sm text-ink-soft p-6 text-center">Loading…</div>
        ) : issues.length === 0 ? (
          <div className="text-sm text-ink-soft p-6 text-center">No books currently issued.</div>
        ) : issues.map((i) => (
          <div key={i.id} className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium text-ink">{i.book_title}</div>
              <div className="text-xs text-ink-soft">
                {i.student_name || i.teacher_name} · due {new Date(i.due_date).toLocaleDateString('en-IN')}
                {i.is_overdue && <span className="text-terracotta-deep font-medium"> · overdue</span>}
              </div>
            </div>
            <button onClick={() => returnBook(i.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-cream-deep text-ink text-sm font-medium hover:bg-cream-deep/40 shrink-0">
              <RotateCcw className="w-3.5 h-3.5" /> Return
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminLibrary() {
  const [tab, setTab] = useState('catalog');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl text-ink flex items-center gap-2">
          <BookOpen className="w-7 h-7 text-terracotta" /> Library
        </h1>
        <p className="text-sm text-ink-soft mt-1">Catalog, issue and return tracking.</p>
      </div>
      <div className="border-b border-cream-deep/70 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t.key ? 'border-terracotta text-terracotta-deep' : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'catalog' ? <CatalogTab /> : <IssuesTab />}
    </div>
  );
}
