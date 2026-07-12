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
    try {
      await apiRequest(`/api/super-admin/schools/${id}/status`, { method: 'PATCH', body: { status: nextStatus } });
      fetchSchools();
    } catch (err) {
      setError(err.message);
    }
  };

  const generateDemo = async (id) => {
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
      <h1 className="text-3xl font-bold text-gray-900">Super Admin — Schools</h1>
      {error && <div className="p-3 bg-red-100 text-red-700 rounded">{error}</div>}

      {demoCreds && (
        <div className="p-4 bg-yellow-50 border border-yellow-300 rounded text-sm relative">
          <button onClick={() => setDemoCreds(null)} className="absolute top-2 right-2 text-gray-500 font-bold">
            ×
          </button>
          <h3 className="font-bold text-yellow-800 mb-2">Generated Demo Accounts</h3>
          <pre className="overflow-auto font-mono text-xs">{JSON.stringify(demoCreds, null, 2)}</pre>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <form onSubmit={handleCreateSchool} className="bg-white p-6 rounded-lg shadow space-y-3 h-fit">
          <h2 className="text-xl font-semibold">Add School</h2>
          <input type="text" placeholder="School Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full p-2 border rounded" />
          <input type="text" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full p-2 border rounded" />
          <input type="text" placeholder="School Contact Phone" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="w-full p-2 border rounded" />
          <hr />
          <h3 className="text-sm font-medium text-gray-500">First Principal Login</h3>
          <input type="text" placeholder="Principal Name" value={form.principal_name} onChange={(e) => setForm({ ...form, principal_name: e.target.value })} required className="w-full p-2 border rounded" />
          <input type="email" placeholder="Principal Email" value={form.principal_email} onChange={(e) => setForm({ ...form, principal_email: e.target.value })} required className="w-full p-2 border rounded" />
          <input type="text" placeholder="Principal Phone" value={form.principal_phone} onChange={(e) => setForm({ ...form, principal_phone: e.target.value })} required className="w-full p-2 border rounded" />
          <input type="password" placeholder="Principal Password" value={form.principal_password} onChange={(e) => setForm({ ...form, principal_password: e.target.value })} required className="w-full p-2 border rounded" />
          <button type="submit" disabled={submitting} className="w-full py-2 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 disabled:opacity-50">
            {submitting ? 'Creating...' : 'Create School'}
          </button>
        </form>

        <div className="lg:col-span-2 bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full border-collapse text-left text-sm text-gray-500">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-700 uppercase">
              <tr>
                <th className="px-6 py-4">School</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Counts</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {schools.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-gray-900">{s.name}</div>
                    <div className="text-xs text-gray-400">{s.address}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs">
                    <div>Teachers: <strong className="text-gray-900">{s.teacher_count}</strong></div>
                    <div>Students: <strong className="text-gray-900">{s.student_count}</strong></div>
                  </td>
                  <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                    <button onClick={() => toggleStatus(s.id, s.status)} className={`text-xs px-2 py-1 rounded font-medium ${s.status === 'active' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {s.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                    <button onClick={() => generateDemo(s.id)} className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800 font-medium">
                      Demo accounts
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
