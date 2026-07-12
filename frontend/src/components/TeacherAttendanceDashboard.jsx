import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';

const STATUS_OPTIONS = ['present', 'absent', 'half_day', 'manual_override'];

export default function TeacherAttendanceDashboard() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await apiRequest('/api/biometric/attendance/today', { method: 'GET' });
      setRows(data);
    } catch (err) {
      setError('Failed to load today\'s attendance.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const correct = async (teacherId, status) => {
    setError('');
    try {
      await apiRequest(`/api/biometric/attendance/by-teacher/${teacherId}`, { method: 'PATCH', body: { status } });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Teacher Attendance — Today</h1>
      {error && <div className="p-3 bg-red-100 text-red-700 text-sm rounded">{error}</div>}

      <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-gray-500">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-700 uppercase">
            <tr>
              <th className="p-3">Teacher</th>
              <th className="p-3">First Punch</th>
              <th className="p-3">Last Punch</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.teacher_id}>
                <td className="p-3 font-medium text-gray-900">{r.teacher_name}</td>
                <td className="p-3 text-xs">{r.first_punch ? new Date(r.first_punch).toLocaleTimeString() : '—'}</td>
                <td className="p-3 text-xs">{r.last_punch ? new Date(r.last_punch).toLocaleTimeString() : '—'}</td>
                <td className="p-3">
                  <select
                    value={r.status}
                    onChange={(e) => correct(r.teacher_id, e.target.value)}
                    className={`text-xs p-1.5 border rounded font-medium ${r.status === 'present' ? 'bg-green-50 text-green-800' : r.status === 'absent' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}
                  >
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
