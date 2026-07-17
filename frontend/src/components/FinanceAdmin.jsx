import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';

function PaymentHistory({ refreshKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    apiRequest('/api/finance/fee/history')
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  return (
    <div className="bg-white p-6 rounded-xl border shadow-sm mt-6">
      <h2 className="text-lg font-bold text-gray-900 mb-3">Recent payments</h2>
      {error && <div className="p-3 mb-3 text-xs bg-red-50 text-red-700 rounded-lg">{error}</div>}
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">No payments recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500 border-b">
                <th className="py-2 pr-4">Student</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Mode</th>
                <th className="py-2 pr-4">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4 font-medium">{r.student_name}</td>
                  <td className="py-2 pr-4">₹{Number(r.amount_paid).toLocaleString('en-IN')}</td>
                  <td className="py-2 pr-4">{r.payment_mode}</td>
                  <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FinanceAdmin() {
  const [feeForm, setFeeForm] = useState({ studentId: '', amount: '', mode: 'Cash', remarks: '' });
  const [proofPhoto, setProofPhoto] = useState(null);
  const [msg, setMsg] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleFeeSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      const data = await apiRequest('/api/finance/fee/collect', {
        method: 'POST',
        body: {
          student_id: parseInt(feeForm.studentId, 10),
          amount_paid: parseFloat(feeForm.amount),
          payment_mode: feeForm.mode,
          remarks: feeForm.remarks,
          proof_photo: proofPhoto || undefined,
        },
      });
      if (data.success) {
        setMsg('Fee recorded successfully! Parameterized transaction complete.');
        setFeeForm({ studentId: '', amount: '', mode: 'Cash', remarks: '' });
        setProofPhoto(null);
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      setMsg(err.message || 'Error saving fee data.');
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="bg-white p-6 rounded-xl border shadow-sm">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Collect Student Fee</h2>
        {msg && <div className="p-3 mb-4 text-xs font-semibold bg-indigo-50 text-indigo-700 rounded-lg">{msg}</div>}

        <form onSubmit={handleFeeSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Student ID</label>
            <input
              type="text"
              value={feeForm.studentId}
              onChange={(e) => setFeeForm({ ...feeForm, studentId: e.target.value })}
              className="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Amount (₹)</label>
              <input
                type="number"
                value={feeForm.amount}
                onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })}
                className="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Mode</label>
              <select
                value={feeForm.mode}
                onChange={(e) => setFeeForm({ ...feeForm, mode: e.target.value })}
                className="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
              >
                <option>Cash</option>
                <option>UPI / Online</option>
                <option>Cheque</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Remarks</label>
            <input
              type="text"
              value={feeForm.remarks}
              onChange={(e) => setFeeForm({ ...feeForm, remarks: e.target.value })}
              className="w-full border rounded-lg p-2 text-sm"
              placeholder="Admission fee, Fine, etc."
            />
          </div>
          {feeForm.mode === 'Cash' && (
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Payment Photo (optional)</label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (!file) return setProofPhoto(null);
                  const reader = new FileReader();
                  reader.onload = () => setProofPhoto(reader.result);
                  reader.readAsDataURL(file);
                }}
                className="block w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
              {proofPhoto && <p className="text-xs text-green-600 mt-1">Photo attached ✓</p>}
            </div>
          )}
          <button
            type="submit"
            className="w-full bg-indigo-600 text-white font-medium p-2.5 rounded-lg text-sm hover:bg-indigo-700 transition"
          >
            Record Secure Payment
          </button>
        </form>
      </div>
      <PaymentHistory refreshKey={refreshKey} />
    </div>
  );
}
