import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';

export default function PrincipalDashboard() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest('/api/analytics/drift-alerts')
      .then((res) => {
        if (res.success) setAlerts(res.data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="mb-8">
        <h1 className="font-display text-3xl text-ink">Principal Oversight Dashboard</h1>
        <p className="text-sm text-ink-soft mt-1">AI-driven patterns surfaced for human review. No automated verdicts.</p>
      </header>

      <div className="bg-amber-warm/20 border-l-4 border-amber-warm p-4 mb-6 rounded-r-md">
        <div className="ml-1">
          <h3 className="text-sm font-semibold text-ink">Pedagogical Guardrail Note</h3>
          <p className="text-xs text-ink-soft mt-1">
            Sustained drift flags trigger only after 3+ consecutive weeks below the school baseline to prevent
            false alarms from a single tough test.
          </p>
        </div>
      </div>

      <h2 className="font-display text-xl text-ink mb-4">Class Performance Drift Flags (3+ Weeks)</h2>

      {error && <div className="p-3 mb-4 text-sm bg-destructive/10 text-destructive rounded-lg">{error}</div>}

      {loading ? (
        <p className="text-ink-soft text-sm">Analyzing metrics…</p>
      ) : alerts.length === 0 ? (
        <div className="p-8 text-center bg-white border border-cream-deep/70 rounded-2xl text-ink-soft text-sm">
          No sustained performance drift detected across any classes this period.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {alerts.map((alert) => (
            <div key={alert.id} className="bg-white border border-cream-deep/70 rounded-2xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider bg-destructive/10 text-destructive px-2.5 py-1 rounded-full">
                    Sustained Drift
                  </span>
                  <span className="text-xs text-ink-soft">{alert.period}</span>
                </div>
                <h3 className="font-display text-lg text-ink">
                  {alert.class_name} — {alert.subject_id}
                </h3>
                <p className="text-sm text-ink-soft mt-1">
                  Teacher: <span className="font-medium text-ink">{alert.teacher_name || 'N/A'}</span>
                </p>
                <p className="text-sm bg-cream-deep/30 text-ink-soft p-3 rounded-lg border border-cream-deep/60 mt-3 italic">
                  "{alert.flag_reason}"
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-cream-deep/60 flex justify-end">
                <button className="text-sm font-semibold text-terracotta-deep hover:text-terracotta transition">
                  Review Syllabus Adjustments &rarr;
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
