import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';
import StudentNav from './StudentNav';

export default function StudentProgress() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest('/api/student/progress')
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const totalDone = data ? data.by_subject.reduce((a, s) => a + parseInt(s.chapters_done, 10), 0) : 0;
  const totalAll = data ? data.by_subject.reduce((a, s) => a + parseInt(s.chapters_total, 10), 0) : 0;
  const overall = totalAll ? Math.round((totalDone / totalAll) * 100) : 0;

  return (
    <div className="min-h-screen bg-cream font-sans">
      <StudentNav />
      <div className="max-w-2xl w-full mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="font-display text-3xl text-ink">My Progress</h1>
          <p className="text-sm text-ink-soft mt-1">A little every day adds up.</p>
        </div>

        {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

        {loading ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : data && (
          <>
            <section className="rounded-3xl p-6 bg-gradient-to-br from-terracotta to-terracotta-deep text-white flex flex-wrap items-center gap-6">
              <div>
                <div className="text-sm opacity-90">Overall completion</div>
                <div className="font-display text-4xl">{overall}%</div>
                <div className="text-sm opacity-90 mt-1">{totalDone} of {totalAll} chapters covered</div>
              </div>
              <div className="ml-auto grid grid-cols-2 gap-4 text-center">
                <div>
                  <div className="text-xs opacity-80">This week</div>
                  <div className="font-display text-2xl">+{data.chapters_this_week}</div>
                </div>
                <div>
                  <div className="text-xs opacity-80">Avg. score (90d)</div>
                  <div className="font-display text-2xl">{data.avg_score_last_90_days ? `${data.avg_score_last_90_days}%` : '—'}</div>
                </div>
              </div>
            </section>

            <section>
              <h2 className="font-display text-xl text-ink mb-3">By subject</h2>
              <div className="grid gap-3">
                {data.by_subject.length === 0 && <p className="text-sm text-ink-soft">No syllabus data yet for your class.</p>}
                {data.by_subject.map((s) => {
                  const total = parseInt(s.chapters_total, 10);
                  const done = parseInt(s.chapters_done, 10);
                  const pct = total ? Math.round((done / total) * 100) : 0;
                  return (
                    <div key={s.subject_id} className="p-4 rounded-2xl bg-white border border-cream-deep/60">
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="font-medium text-ink">{s.subject_id}</span>
                        <span className="text-xs text-ink-soft">{done}/{total}</span>
                      </div>
                      <div className="h-2 rounded-full bg-cream-deep overflow-hidden">
                        <div className="h-full bg-terracotta" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
