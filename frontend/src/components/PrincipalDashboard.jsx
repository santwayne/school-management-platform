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
        <h1 className="text-3xl font-extrabold text-gray-950">Principal Oversight Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">AI-driven patterns surfaced for human review. No automated verdicts.</p>
      </header>

      <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 mb-6 rounded-r-md">
        <div className="flex">
          <div className="ml-3">
            <h3 className="text-sm font-semibold text-yellow-800">Pedagogical Guardrail Note</h3>
            <p className="text-xs text-yellow-700 mt-1">
              Sustained drift flags trigger only after 3+ consecutive weeks below the school baseline to prevent
              false alarms from a single tough test.
            </p>
          </div>
        </div>
      </div>

      <h2 className="text-xl font-bold text-gray-800 mb-4">Class Performance Drift Flags (3+ Weeks)</h2>

      {error && <div className="p-3 mb-4 text-sm bg-red-50 text-red-700 rounded">{error}</div>}

      {loading ? (
        <p className="text-gray-500">Analyzing metrics...</p>
      ) : alerts.length === 0 ? (
        <div className="p-8 text-center bg-white border rounded-lg text-gray-500">
          No sustained performance drift detected across any classes this period.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {alerts.map((alert) => (
            <div key={alert.id} className="bg-white border rounded-xl p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider bg-red-100 text-red-700 px-2.5 py-1 rounded-full">
                    Sustained Drift
                  </span>
                  <span className="text-xs text-gray-400">{alert.period}</span>
                </div>
                <h3 className="text-lg font-bold text-gray-900">
                  {alert.class_name} — {alert.subject_id}
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  Teacher: <span className="font-medium text-gray-800">{alert.teacher_name || 'N/A'}</span>
                </p>
                <p className="text-sm bg-gray-50 text-gray-700 p-3 rounded-lg border mt-3 italic">
                  "{alert.flag_reason}"
                </p>
              </div>

              <div className="mt-4 pt-3 border-t flex justify-end">
                <button className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition">
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
