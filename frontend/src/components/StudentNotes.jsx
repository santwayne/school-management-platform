import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../api';
import StudentShell from './StudentShell';

export default function StudentNotes() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState({ title: '', content: '' });
  const [saveTimer, setSaveTimer] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/api/student/notes');
      setNotes(data);
      if (data.length && !activeId) selectNote(data[0]);
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

  const selectNote = (n) => {
    setActiveId(n.id);
    setDraft({ title: n.title, content: n.content });
  };

  const createNote = async () => {
    try {
      const n = await apiRequest('/api/student/notes', { method: 'POST', body: { title: 'Untitled note', content: '' } });
      setNotes((prev) => [n, ...prev]);
      selectNote(n);
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteNote = async (id) => {
    try {
      await apiRequest(`/api/student/notes/${id}`, { method: 'DELETE' });
      const remaining = notes.filter((n) => n.id !== id);
      setNotes(remaining);
      if (activeId === id) {
        if (remaining.length) selectNote(remaining[0]);
        else { setActiveId(null); setDraft({ title: '', content: '' }); }
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const onChange = (field, value) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (saveTimer) clearTimeout(saveTimer);
    const t = setTimeout(async () => {
      if (!activeId) return;
      try {
        const updated = await apiRequest(`/api/student/notes/${activeId}`, {
          method: 'PATCH',
          body: { [field]: value },
        });
        setNotes((prev) => prev.map((n) => (n.id === activeId ? updated : n)));
      } catch (err) {
        setError(err.message);
      }
    }, 600); // debounced autosave
    setSaveTimer(t);
  };

  return (
    <StudentShell>
      <div className="max-w-4xl w-full mx-auto px-4 py-6">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h1 className="font-display text-3xl text-ink">Notes</h1>
            <p className="text-sm text-ink-soft mt-1">Your own study notes — saved automatically.</p>
          </div>
          <button onClick={createNote} className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition">
            <Plus className="w-4 h-4" /> New note
          </button>
        </div>

        {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive mb-4">{error}</div>}

        {loading ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : (
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-1 space-y-2">
              {notes.length === 0 && <p className="text-sm text-ink-soft">No notes yet.</p>}
              {notes.map((n) => (
                <div
                  key={n.id}
                  onClick={() => selectNote(n)}
                  className={`p-3 rounded-xl border cursor-pointer group ${activeId === n.id ? 'bg-white border-terracotta' : 'bg-white/60 border-cream-deep/60 hover:bg-white'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{n.title || 'Untitled note'}</div>
                      <div className="text-xs text-ink-soft mt-0.5">{new Date(n.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); deleteNote(n.id); }} className="opacity-0 group-hover:opacity-100 text-ink-soft hover:text-destructive shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="md:col-span-2">
              {activeId ? (
                <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
                  <input
                    value={draft.title}
                    onChange={(e) => onChange('title', e.target.value)}
                    className="w-full font-display text-xl text-ink outline-none mb-3"
                    placeholder="Note title"
                  />
                  <textarea
                    value={draft.content}
                    onChange={(e) => onChange('content', e.target.value)}
                    rows={14}
                    className="w-full text-sm text-ink outline-none resize-none"
                    placeholder="Start writing…"
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-cream-deep bg-white/60 p-10 text-center text-sm text-ink-soft">
                  Select a note, or create a new one.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </StudentShell>
  );
}