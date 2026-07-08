import React, { useState } from 'react';
import { apiRequest } from '../api';

export default function FinanceAdmin() {
  const [feeForm, setFeeForm] = useState({ studentId: '', amount: '', mode: 'Cash', remarks: '' });
  const [cashRequests, setCashRequests] = useState([
    // Placeholder row for UI preview — replace with a GET /api/finance/petty-cash list endpoint when available.
    { id: 1, requested_by: 'Staff member', amount: 450, purpose: 'Whiteboard Markers', status: 'PENDING' },
  ]);
  const [msg, setMsg] = useState('');

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
        },
      });
      if (data.success) {
        setMsg('Fee recorded successfully! Parameterized transaction complete.');
        setFeeForm({ studentId: '', amount: '', mode: 'Cash', remarks: '' });
      }
    } catch (err) {
      setMsg(err.message || 'Error saving fee data.');
    }
  };

  const handleCashAction = async (id, action) => {
    try {
      const data = await apiRequest(`/api/finance/petty-cash/approve/${id}`, {
        method: 'PATCH',
        body: { status: action },
      });
      if (data.success) {
        setCashRequests((prev) => prev.map((req) => (req.id === id ? { ...req, status: action } : req)));
      }
    } catch (err) {
      setMsg(err.message || 'Error updating request.');
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* SECTION 1: FEE COLLECTION FORM */}
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
          <button
            type="submit"
            className="w-full bg-indigo-600 text-white font-medium p-2.5 rounded-lg text-sm hover:bg-indigo-700 transition"
          >
            Record Secure Payment
          </button>
        </form>
      </div>

      {/* SECTION 2: PETTY CASH APPROVAL WORKFLOW */}
      <div className="bg-white p-6 rounded-xl border shadow-sm">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Petty Cash Approvals</h2>
        <div className="space-y-4">
          {cashRequests.map((req) => (
            <div key={req.id} className="p-4 border rounded-xl flex justify-between items-center bg-gray-50">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-800">₹{req.amount}</span>
                  <span
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                      req.status === 'PENDING'
                        ? 'bg-yellow-100 text-yellow-800'
                        : req.status === 'APPROVED'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {req.status}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  <span className="font-medium text-gray-700">{req.requested_by}</span>: {req.purpose}
                </p>
              </div>

              {req.status === 'PENDING' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCashAction(req.id, 'APPROVED')}
                    className="px-2.5 py-1 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-700 transition"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleCashAction(req.id, 'REJECTED')}
                    className="px-2.5 py-1 text-xs font-bold bg-red-100 text-red-700 rounded hover:bg-red-200 transition"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
