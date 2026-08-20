import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import FeeDashboard from './FeeDashboard';

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
      <h2 className="text-lg font-bold text-ink mb-3">Recent payments</h2>
      {error && <div className="p-3 mb-3 text-xs bg-destructive/10 text-destructive rounded-lg">{error}</div>}
      {loading ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-soft">No payments recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-ink-soft border-b">
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
                  <td className="py-2 pr-4 text-ink-soft whitespace-nowrap">
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

export function StudentPicker({ selected, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      apiRequest(`/api/finance/students/search?q=${encodeURIComponent(query)}`)
        .then((rows) => setResults(rows))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  if (selected) {
    return (
      <div className="w-full border rounded-lg p-2 text-sm flex items-center justify-between bg-cream-deep/20">
        <span>
          <span className="font-medium">{selected.name}</span>
          <span className="text-ink-soft"> · {selected.login_id}{selected.class_name ? ` · ${selected.class_name}` : ''}</span>
        </span>
        <button type="button" onClick={() => onSelect(null)} className="text-xs text-terracotta-deep font-medium ml-2 shrink-0">
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search by student name or login ID (e.g. STD-2-KKSY)"
        className="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-terracotta/40"
      />
      {open && query.trim() && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-cream-deep rounded-lg shadow-md max-h-56 overflow-y-auto">
          {searching ? (
            <div className="p-2 text-xs text-ink-soft">Searching…</div>
          ) : results.length === 0 ? (
            <div className="p-2 text-xs text-ink-soft">No students match "{query}".</div>
          ) : (
            results.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onSelect(s);
                  setQuery('');
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-cream-deep/40"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-ink-soft"> · {s.login_id}{s.class_name ? ` · ${s.class_name}` : ''}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Item 5 of the QA fix list: lets Principal/Accountant set an expected fee
// amount per class so the Fee Dashboard's Expected/Unpaid stop always
// showing Rs 0 — see the fee_structures comment in schema.sql for why this
// is one amount per class rather than per-term/fee-type.
function FeeStructure() {
  const [rows, setRows] = useState([]);
  const [edits, setEdits] = useState({}); // class_id -> string being typed
  const [saving, setSaving] = useState(null); // class_id currently saving
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/api/finance/fee-structure');
      setRows(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (classId) => {
    const value = edits[classId];
    if (value === undefined || value === '' || Number(value) < 0) return;
    setSaving(classId);
    setMsg('');
    setError('');
    try {
      await apiRequest(`/api/finance/fee-structure/${classId}`, { method: 'PUT', body: { amount: Number(value) } });
      setMsg('Saved.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-6 rounded-xl border shadow-sm">
      <h2 className="font-display text-xl font-bold text-ink mb-1">Fee Structure</h2>
      <p className="text-sm text-ink-soft mb-4">Set the expected fee amount per class. This drives the Expected/Unpaid totals on the Dashboard tab.</p>
      {error && <div className="p-3 mb-3 text-xs bg-destructive/10 text-destructive rounded-lg">{error}</div>}
      {/* AL-4: success confirmations were styled in the same terracotta
          (orange/red) brand tone used for validation errors elsewhere —
          switched to green, the conventional success color. */}
      {msg && <div className="p-3 mb-3 text-xs font-semibold bg-emerald-500/10 text-emerald-700 rounded-lg">{msg}</div>}
      {loading ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-soft">No classes found — add classes first under Classes.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.class_id} className="flex items-center gap-3 py-1.5 border-b border-cream-deep/60 last:border-0">
              <span className="flex-1 text-sm font-medium">{r.class_name}</span>
              <span className="text-xs text-ink-soft w-24">
                {r.amount != null ? `Currently ₹${Number(r.amount).toLocaleString('en-IN')}` : 'Not set'}
              </span>
              <input
                type="number"
                min="0"
                placeholder="Amount (₹)"
                value={edits[r.class_id] ?? ''}
                onChange={(e) => setEdits((prev) => ({ ...prev, [r.class_id]: e.target.value }))}
                className="w-32 border rounded-lg p-2 text-sm"
              />
              <button
                onClick={() => save(r.class_id)}
                disabled={saving === r.class_id || !edits[r.class_id]}
                className="px-3 py-2 rounded-lg bg-terracotta text-primary-foreground text-xs font-medium hover:bg-terracotta-deep transition disabled:opacity-50"
              >
                {saving === r.class_id ? 'Saving…' : 'Save'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'collect', label: 'Collect Fee' },
  { key: 'structure', label: 'Fee Structure' },
];

export default function FinanceAdmin() {
  const [tab, setTab] = useState('dashboard');
  const [student, setStudent] = useState(null);
  const [feeForm, setFeeForm] = useState({ amount: '', mode: 'Cash', remarks: '' });
  const [proofPhoto, setProofPhoto] = useState(null);
  const [msg, setMsg] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleFeeSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    if (!student) {
      setMsg('Please search for and select a student first.');
      return;
    }
    try {
      const data = await apiRequest('/api/finance/fee/collect', {
        method: 'POST',
        body: {
          student_id: student.id,
          amount_paid: parseFloat(feeForm.amount),
          payment_mode: feeForm.mode,
          remarks: feeForm.remarks,
          proof_photo: proofPhoto || undefined,
        },
      });
      if (data.success) {
        setMsg('Fee recorded successfully!');
        setStudent(null);
        setFeeForm({ amount: '', mode: 'Cash', remarks: '' });
        setProofPhoto(null);
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      setMsg(err.message || 'Error saving fee data.');
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="border-b border-cream-deep/70 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t.key ? 'border-terracotta text-terracotta-deep' : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <FeeDashboard />}

      {tab === 'structure' && <FeeStructure />}

      {tab === 'collect' && (
        <div className="max-w-2xl mx-auto">
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <h2 className="font-display text-xl font-bold text-ink mb-4">Collect Student Fee</h2>
            {/* AL-4: "Fee recorded successfully!" was styled in the same
                terracotta (orange/red) brand tone used for validation errors
                elsewhere — switched to green, the conventional success color. */}
            {msg && <div className="p-3 mb-4 text-xs font-semibold bg-emerald-500/10 text-emerald-700 rounded-lg">{msg}</div>}

            <form onSubmit={handleFeeSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-ink-soft uppercase mb-1">Student</label>
                <StudentPicker selected={student} onSelect={setStudent} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-ink-soft uppercase mb-1">Amount (₹)</label>
                  <input
                    type="number"
                    value={feeForm.amount}
                    onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })}
                    className="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-terracotta/40"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-ink-soft uppercase mb-1">Mode</label>
                  <select
                    value={feeForm.mode}
                    onChange={(e) => setFeeForm({ ...feeForm, mode: e.target.value })}
                    className="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-terracotta/40"
                  >
                    <option>Cash</option>
                    <option>UPI / Online</option>
                    <option>Cheque</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-soft uppercase mb-1">Remarks</label>
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
                  <label className="block text-xs font-bold text-ink-soft uppercase mb-1">Payment Photo (optional)</label>
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
                    className="block w-full text-xs text-ink-soft file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-terracotta/5 file:text-terracotta-deep hover:file:bg-terracotta/10"
                  />
                  {proofPhoto && <p className="text-xs text-green-600 mt-1">Photo attached ✓</p>}
                </div>
              )}
              <button
                type="submit"
                className="w-full bg-terracotta text-white font-medium p-2.5 rounded-lg text-sm hover:bg-terracotta-deep transition"
              >
                Record Secure Payment
              </button>
            </form>
          </div>
          <PaymentHistory refreshKey={refreshKey} />
        </div>
      )}
    </div>
  );
}
