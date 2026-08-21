import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';

const emptyForm = {
  name: '',
  address: '',
  contact_phone: '',
  principal_name: '',
  principal_email: '',
  principal_phone: '',
  principal_password: '',
};

export default function SuperAdminDashboard() {
  const [schools, setSchools] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [demoCreds, setDemoCreds] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // P-14: toggleStatus had a couple seconds of round-trip with no loading
  // indicator, inviting a second click that fired a second toggle before
  // the first one had even come back — tracking the busy school id lets the
  // button disable itself and show progress for exactly that window.
  const [statusBusyId, setStatusBusyId] = useState(null);

  const fetchSchools = async () => {
    try {
      const data = await apiRequest('/api/super-admin/schools', { method: 'GET' });
      setSchools(data);
    } catch (err) {
      setError('Failed to load schools list.');
    }
  };

  useEffect(() => {
    fetchSchools();
  }, []);

  const handleCreateSchool = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      // NOTE: apiRequest already JSON.stringifies the body — pass the plain object.
      await apiRequest('/api/super-admin/schools', { method: 'POST', body: form });
      setForm(emptyForm);
      fetchSchools();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (id, currentStatus) => {
    const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
    setStatusBusyId(id);
    setError('');
    try {
      await apiRequest(`/api/super-admin/schools/${id}/status`, { method: 'PATCH', body: { status: nextStatus } });
      await fetchSchools();
    } catch (err) {
      setError(err.message);
    } finally {
      setStatusBusyId(null);
    }
  };

  // P-6: there was previously no way to remove a school at all, only
  // Suspend/Activate. Deletion is irreversible and wipes every table scoped
  // to that school, so this asks for the school's exact name typed back —
  // matching the backend's confirm_name requirement — rather than a single
  // confirm() click.
  const deleteSchool = async (id, name) => {
    const typed = window.prompt(`This permanently deletes "${name}" and ALL of its data (staff, students, fees, everything). This cannot be undone.\n\nType the school's name to confirm:`);
    if (typed === null) return;
    setError('');
    try {
      await apiRequest(`/api/super-admin/schools/${id}`, { method: 'DELETE', body: { confirm_name: typed } });
      fetchSchools();
    } catch (err) {
      setError(err.message);
    }
  };

  const generateDemo = async (id) => {
    if (!window.confirm('Regenerate demo accounts for this school? Any demo credentials already shared with a prospect will stop working.')) return;
    setError('');
    try {
      const data = await apiRequest(`/api/super-admin/schools/${id}/test-users`, { method: 'POST' });
      setDemoCreds(data);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <h1 className="font-display text-3xl font-bold text-ink">Super Admin — Schools</h1>
      {error && <div className="p-3 bg-red-100 text-destructive rounded">{error}</div>}

      {demoCreds && (
        <div className="p-4 bg-yellow-50 border border-yellow-300 rounded text-sm relative">
          <button onClick={() => setDemoCreds(null)} className="absolute top-2 right-2 text-ink-soft font-bold">
            ×
          </button>
          <h3 className="font-bold text-yellow-800 mb-2">Generated Demo Accounts</h3>
          <pre className="overflow-auto font-mono text-xs">{JSON.stringify(demoCreds, null, 2)}</pre>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <form onSubmit={handleCreateSchool} autoComplete="off" className="bg-white p-6 rounded-lg shadow space-y-3 h-fit">
          <h2 className="font-display text-xl font-semibold">Add School</h2>
          <input type="text" placeholder="School Name" autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full p-2 border rounded" />
          <input type="text" placeholder="Address" autoComplete="off" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full p-2 border rounded" />
          <input type="text" placeholder="School Contact Phone" autoComplete="off" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="w-full p-2 border rounded" />
          <hr />
          <h3 className="text-sm font-medium text-ink-soft">First Principal Login</h3>
          <input type="text" placeholder="Principal Name" autoComplete="off" value={form.principal_name} onChange={(e) => setForm({ ...form, principal_name: e.target.value })} required className="w-full p-2 border rounded" />
          {/* name="principal-email-new" + autoComplete="off" keeps the browser's saved super-admin
              login from being suggested/autofilled into this unrelated principal-creation field. */}
          <input type="email" name="principal-email-new" placeholder="Principal Email" autoComplete="off" value={form.principal_email} onChange={(e) => setForm({ ...form, principal_email: e.target.value })} required className="w-full p-2 border rounded" />
          <input type="text" placeholder="Principal Phone" autoComplete="off" value={form.principal_phone} onChange={(e) => setForm({ ...form, principal_phone: e.target.value })} required className="w-full p-2 border rounded" />
          <input type="password" name="principal-password-new" placeholder="Principal Password" autoComplete="new-password" value={form.principal_password} onChange={(e) => setForm({ ...form, principal_password: e.target.value })} required className="w-full p-2 border rounded" />
          <button type="submit" disabled={submitting} className="w-full py-2 bg-terracotta text-white rounded font-medium hover:bg-terracotta-deep disabled:opacity-50">
            {submitting ? 'Creating...' : 'Create School'}
          </button>
        </form>

        <div className="lg:col-span-2 bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full border-collapse text-left text-sm text-ink-soft">
            <thead className="bg-cream text-xs font-semibold text-ink-soft uppercase">
              <tr>
                <th className="px-6 py-4">School</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Counts</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-deep/60">
              {schools.map((s) => (
                <tr key={s.id} className="hover:bg-cream">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-ink">{s.name}</div>
                    <div className="text-xs text-ink-soft">{s.address}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs">
                    <div>Teachers: <strong className="text-ink">{s.teacher_count}</strong></div>
                    <div>Students: <strong className="text-ink">{s.student_count}</strong></div>
                  </td>
                  <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => toggleStatus(s.id, s.status)}
                      disabled={statusBusyId === s.id}
                      className={`text-xs px-2 py-1 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed ${s.status === 'active' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}
                    >
                      {statusBusyId === s.id ? '…' : s.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                    <button onClick={() => generateDemo(s.id)} className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800 font-medium">
                      Demo accounts
                    </button>
                    <button onClick={() => deleteSchool(s.id, s.name)} className="text-xs px-2 py-1 rounded bg-red-100 text-red-800 font-medium">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
