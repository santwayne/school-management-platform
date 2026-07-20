import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';
import StudentShell from './StudentShell';

export default function StudentHomework() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await apiRequest('/api/student/homework'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (id) => {
    // optimistic update
    setItems((prev) => prev.map((h) => (h.id === id ? { ...h, done: !h.done } : h)));
    try {
      await apiRequest(`/api/student/homework/${id}/toggle`, { method: 'POST' });
    } catch (err) {
      setError(err.message);
      load(); // revert to server truth on failure
    }
  };

  const list = items.filter((h) => (filter === 'todo' ? !h.done : filter === 'done' ? h.done : true));
  const doneCount = items.filter((h) => h.done).length;

  return (
    <StudentShell>
      <div className="space-y-4">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-3xl text-ink">Homework</h1>
            <p className="text-sm text-ink-soft mt-1">{doneCount} of {items.length} done.</p>
          </div>
          <div className="flex rounded-xl bg-cream-deep/60 p-1 text-sm">
            {['all', 'todo', 'done'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg capitalize ${filter === f ? 'bg-white shadow-sm font-medium' : 'text-ink-soft'}`}
              >
                {f === 'todo' ? 'To do' : f}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

        {loading ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing here.</p>
        ) : (
          <div className="grid gap-3">
            {list.map((h) => (
              <div key={h.id} className="flex items-start gap-3 p-4 rounded-2xl bg-white border border-cream-deep/60">
                <button
                  onClick={() => toggle(h.id)}
                  className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition ${
                    h.done ? 'bg-terracotta border-terracotta text-white' : 'border-cream-deep'
                  }`}
                >
                  {h.done && '✓'}
                </button>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium ${h.done ? 'line-through text-ink-soft' : 'text-ink'}`}>{h.title}</div>
                  {h.description && <p className="text-sm text-ink-soft mt-0.5">{h.description}</p>}
                  <div className="text-xs text-ink-soft mt-1 flex gap-3">
                    <span className="uppercase tracking-wide">{h.subject_id}</span>
                    {h.due_date && <span>Due {new Date(h.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </StudentShell>
  );
}