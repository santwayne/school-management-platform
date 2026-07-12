import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';

export default function BiometricDeviceManager() {
  const [devices, setDevices] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [form, setForm] = useState({ vendor: 'zkteco', device_serial: '', label: '' });
  const [mapForm, setMapForm] = useState({ device_id: '', teacher_id: '', device_internal_id: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const [d, t] = await Promise.all([
        apiRequest('/api/biometric/devices', { method: 'GET' }),
        apiRequest('/api/academics/teachers', { method: 'GET' }),
      ]);
      setDevices(d);
      setTeachers(t);
    } catch (err) {
      setError('Failed to load devices.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAddDevice = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiRequest('/api/biometric/devices', { method: 'POST', body: form });
      setForm({ vendor: 'zkteco', device_serial: '', label: '' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMapTeacher = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiRequest(`/api/biometric/devices/${mapForm.device_id}/map-teacher`, {
        method: 'POST',
        body: { teacher_id: mapForm.teacher_id, device_internal_id: mapForm.device_internal_id },
      });
      setMessage('Teacher mapped to device.');
      setMapForm({ ...mapForm, device_internal_id: '' });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCSVUpload = (deviceId) => (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const lines = evt.target.result.split('\n').map((l) => l.trim()).filter(Boolean);
      const headers = lines[0].split(',').map((h) => h.trim());
      const rows = lines.slice(1).map((line) => {
        const values = line.split(',');
        const row = {};
        headers.forEach((h, i) => (row[h] = values[i]?.trim()));
        return row;
      });
      try {
        const res = await apiRequest('/api/biometric/csv-import', { method: 'POST', body: { device_id: deviceId, rows } });
        setMessage(`Imported ${res.inserted_count} punches (${res.skipped_count} skipped — unmapped IDs).`);
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Biometric Devices</h1>
      {message && <div className="p-3 bg-green-100 text-green-700 text-sm rounded">{message}</div>}
      {error && <div className="p-3 bg-red-100 text-red-700 text-sm rounded">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <form onSubmit={handleAddDevice} className="bg-white p-5 border rounded-lg shadow-sm space-y-3">
          <h2 className="text-lg font-semibold text-gray-800">Register Device</h2>
          <select value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} className="w-full p-2 border text-sm rounded bg-white">
            <option value="zkteco">ZKTeco (push)</option>
            <option value="csv_import">CSV Import (no push support)</option>
          </select>
          <input type="text" placeholder="Device Serial (optional)" value={form.device_serial} onChange={(e) => setForm({ ...form, device_serial: e.target.value })} className="w-full p-2 border text-sm rounded" />
          <input type="text" placeholder="Label, e.g. Main Gate" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="w-full p-2 border text-sm rounded" />
          <button type="submit" className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium">Add Device</button>
        </form>

        <form onSubmit={handleMapTeacher} className="bg-white p-5 border rounded-lg shadow-sm space-y-3">
          <h2 className="text-lg font-semibold text-gray-800">Map Teacher to Device ID</h2>
          <select value={mapForm.device_id} onChange={(e) => setMapForm({ ...mapForm, device_id: e.target.value })} required className="w-full p-2 border text-sm rounded bg-white">
            <option value="">Select device</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.label || d.vendor} ({d.vendor})</option>)}
          </select>
          <select value={mapForm.teacher_id} onChange={(e) => setMapForm({ ...mapForm, teacher_id: e.target.value })} required className="w-full p-2 border text-sm rounded bg-white">
            <option value="">Select teacher</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input type="text" placeholder="Device's internal enrollment ID" value={mapForm.device_internal_id} onChange={(e) => setMapForm({ ...mapForm, device_internal_id: e.target.value })} required className="w-full p-2 border text-sm rounded" />
          <button type="submit" className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-medium">Map</button>
        </form>
      </div>

      <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-gray-500">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-700 uppercase">
            <tr>
              <th className="p-3">Label</th>
              <th className="p-3">Vendor</th>
              <th className="p-3">Webhook URL / Token</th>
              <th className="p-3">CSV Fallback</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {devices.map((d) => (
              <tr key={d.id}>
                <td className="p-3 font-medium text-gray-900">{d.label || '—'}</td>
                <td className="p-3">{d.vendor}</td>
                <td className="p-3 font-mono text-xs">
                  /api/biometric/webhook/{d.vendor}?token={d.webhook_token}
                </td>
                <td className="p-3">
                  <input type="file" accept=".csv" onChange={handleCSVUpload(d.id)} className="text-xs" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
