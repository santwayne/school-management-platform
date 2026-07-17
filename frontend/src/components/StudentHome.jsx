import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Flame } from 'lucide-react';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';
import StudentShell from './StudentShell';

export default function StudentHome() {
  const { user } = useAuth();
  const [rewards, setRewards] = useState(null);
  const [homework, setHomework] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([apiRequest('/api/student/rewards'), apiRequest('/api/student/homework')])
      .then(([r, h]) => {
        setRewards(r);
        setHomework(h);
      })
      .catch((err) => setError(err.message));
  }, []);

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const todo = homework.filter((h) => !h.done).slice(0, 4);

  return (
    <StudentShell>
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-8 bg-gradient-to-br from-terracotta via-terracotta to-joy-berry text-white shadow-lg">
        <div className="absolute -right-8 -top-6 text-[140px] opacity-20 select-none">🎒</div>
        <div className="relative">
          <p className="text-sm opacity-90">{today}</p>
          <h1 className="font-display text-3xl sm:text-4xl mt-1">Hi {user?.name?.split(' ')[0] || 'there'}! Ready to learn today?</h1>
          <p className="mt-2 text-white/85 max-w-md">Pick up where you left off — or ask your AI tutor anything.</p>
          <Link
            to="/tutor"
            className="inline-flex items-center gap-2 mt-5 px-5 py-3 rounded-2xl bg-white text-terracotta-deep font-semibold shadow hover:scale-[1.03] transition-transform"
          >
            <Sparkles className="w-5 h-5" />
            Ask AI Tutor
          </Link>
        </div>
      </section>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl p-5 bg-white border border-cream-deep/60 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-warm/30 flex items-center justify-center text-2xl">
            <Flame className="w-6 h-6 text-terracotta" />
          </div>
          <div>
            <div className="text-2xl font-display font-semibold">{rewards ? rewards.streak : '—'} days</div>
            <div className="text-xs text-ink-soft">Current streak — keep it going!</div>
          </div>
        </div>
        <div className="rounded-2xl p-5 bg-white border border-cream-deep/60 md:col-span-2">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-semibold">Homework this week</span>
            <span className="text-ink-soft">{homework.filter((h) => h.done).length}/{homework.length} done</span>
          </div>
          <div className="h-2 rounded-full bg-cream-deep overflow-hidden">
            <div
              className="h-full bg-terracotta transition-all duration-700"
              style={{ width: `${homework.length ? (homework.filter((h) => h.done).length / homework.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl">Up next</h2>
          <Link to="/homework" className="text-sm text-terracotta-deep font-medium hover:text-terracotta">See all →</Link>
        </div>
        {todo.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-cream-deep bg-white/60 p-6 text-center text-sm text-ink-soft">
            All caught up — nothing pending right now.
          </div>
        ) : (
          <div className="grid gap-2">
            {todo.map((h) => (
              <div key={h.id} className="flex items-center gap-3 p-3.5 rounded-2xl bg-white border border-cream-deep/60">
                <div className="w-2 h-2 rounded-full bg-terracotta shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{h.title}</div>
                  <div className="text-xs text-ink-soft uppercase tracking-wide">{h.subject_id}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </StudentShell>
  );
}
