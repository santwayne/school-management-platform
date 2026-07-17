import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';
import StudentShell from './StudentShell';

const BADGE_EMOJI = { streak_5: '🔥', streak_10: '🏆', perfect_week: '🎯', quiz_master: '💯' };

export default function StudentRewards() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest('/api/student/rewards')
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <StudentShell>
      <div className="max-w-2xl w-full mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="font-display text-3xl text-ink">Rewards</h1>
          <p className="text-sm text-ink-soft mt-1">Collect badges as you learn. No pressure — just fun.</p>
        </div>

        {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

        {loading ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : data && (
          <>
            <section className="rounded-3xl p-6 bg-gradient-to-br from-terracotta to-terracotta-deep text-white flex items-center gap-6 flex-wrap">
              <div>
                <div className="text-sm opacity-90">Total XP</div>
                <div className="font-display text-4xl">{data.xp.toLocaleString('en-IN')}</div>
              </div>
              <div className="ml-auto flex gap-6 text-center">
                <div>
                  <div className="font-display text-2xl">🔥 {data.streak}</div>
                  <div className="text-xs opacity-80">day streak</div>
                </div>
                <div>
                  <div className="font-display text-2xl">{data.homework_done}</div>
                  <div className="text-xs opacity-80">homework done</div>
                </div>
                <div>
                  <div className="font-display text-2xl">{data.tutor_sessions}</div>
                  <div className="text-xs opacity-80">tutor sessions</div>
                </div>
              </div>
            </section>

            <section>
              <h2 className="font-display text-xl text-ink mb-3">Badges</h2>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                {data.badges.map((b) => (
                  <div
                    key={b.key}
                    className={`rounded-2xl p-5 text-center border ${
                      b.earned ? 'bg-white border-cream-deep/60' : 'bg-cream-deep/40 border-cream-deep'
                    }`}
                  >
                    <div className={`text-4xl ${b.earned ? '' : 'grayscale opacity-60'}`}>{BADGE_EMOJI[b.key]}</div>
                    <div className={`mt-2 text-sm font-semibold ${b.earned ? 'text-ink' : 'text-ink-soft'}`}>{b.label}</div>
                    <div className={`text-[10px] uppercase tracking-wider mt-1 ${b.earned ? 'text-emerald-600' : 'text-ink-soft/80'}`}>
                      {b.earned ? 'Earned' : b.progress}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <p className="text-xs text-ink-soft">
              How XP is earned: {data.xp_rules.attendance} XP/day present · {data.xp_rules.homework} XP/homework done ·{' '}
              {data.xp_rules.tutorSession} XP/tutor session · {data.xp_rules.goodTest} XP/confirmed test score 80%+
            </p>
          </>
        )}
      </div>
    </StudentShell>
  );
}