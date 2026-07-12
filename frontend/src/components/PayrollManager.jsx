import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function PayrollManager() {
  const [salaries, setSalaries] = useState([]);
  const [period, setPeriod] = useState(currentPeriod());
  const [runs, setRuns] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const [s, r] = await Promise.all([
        apiRequest('/api/payroll/salary', { method: 'GET' }),
        apiRequest(`/api/payroll?period=${period}`, { method: 'GET' }),
      ]);
      setSalaries(s);
      setRuns(r);
    } catch (err) {
      setError('Failed to load payroll data.');
    }
  };

  useEffect(() => {
    load();
  }, [period]);

  const setSalary = async (teacherId, amount) => {
    if (!amount) return;
    setError('');
    try {
      await apiRequest('/api/payroll/salary', { method: 'POST', body: { teacher_id: teacherId, monthly_amount: amount } });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const runPayroll = async () => {
    setError('');
    try {
      const res = await apiRequest('/api/payroll/run', { method: 'POST', body: { period } });
      setMessage(`Generated ${res.generated_count} payroll rows for ${period}.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const markPaid = async (id) => {
    setError('');
    try {
      await apiRequest(`/api/payroll/${id}/mark-paid`, { method: 'PATCH' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Payroll</h1>
      {message && <div className="p-3 bg-green-100 text-green-700 text-sm rounded">{message}</div>}
      {error && <div className="p-3 bg-red-100 text-red-700 text-sm rounded">{error}</div>}

      <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
        <h2 className="p-4 font-semibold text-gray-800 border-b">Monthly Salary</h2>
        <table className="w-full text-left text-sm text-gray-500">
          <tbody className="divide-y">
            {salaries.map((s) => (
              <tr key={s.teacher_id}>
                <td className="p-3 font-medium text-gray-900">{s.name}</td>
                <td className="p-3">
                  <input
                    type="number"
                    defaultValue={s.monthly_amount || ''}
                    placeholder="Set salary"
                    onBlur={(e) => e.target.value && setSalary(s.teacher_id, e.target.value)}
                    className="p-1.5 border text-sm rounded w-32"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border rounded-lg shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Period:</label>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="p-1.5 border text-sm rounded" />
          <button onClick={runPayroll} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium">
            Run Payroll for {period}
          </button>
        </div>
      </div>

      <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
        <h2 className="p-4 font-semibold text-gray-800 border-b">Payroll — {period}</h2>
        <table className="w-full text-left text-sm text-gray-500">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-700 uppercase">
            <tr>
              <th className="p-3">Teacher</th>
              <th className="p-3">Amount</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="p-3 font-medium text-gray-900">{r.teacher_name}</td>
                <td className="p-3">₹{r.amount_paid}</td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.status === 'PAID' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                    {r.status}
                  </span>
                </td>
                <td className="p-3 text-right">
                  {r.status === 'PENDING' && (
                    <button onClick={() => markPaid(r.id)} className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-800 font-medium">
                      Mark Paid
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
