import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';

export default function ClassNotesComposer() {
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [notes, setNotes] = useState([]);
  const [form, setForm] = useState({ class_id: '', subject_id: '', title: '', body_text: '', attachment_url: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const [c, s, n] = await Promise.all([
        apiRequest('/api/academics/classes', { method: 'GET' }),
        apiRequest('/api/academics/subjects', { method: 'GET' }),
        apiRequest('/api/class-notes', { method: 'GET' }),
      ]);
      setClasses(c);
      setSubjects(s);
      setNotes(n);
    } catch (err) {
      setError('Failed to load classes/subjects/notes.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiRequest('/api/class-notes', { method: 'POST', body: form });
      setForm({ class_id: '', subject_id: '', title: '', body_text: '', attachment_url: '' });
      setMessage('Note created — click Send below to deliver it.');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSend = async (id) => {
    setError('');
    try {
      const res = await apiRequest(`/api/class-notes/${id}/send`, { method: 'POST' });
      setMessage(`Queued for ${res.queued_for} parents.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Class Notes</h1>
      {message && <div className="p-3 bg-green-100 text-green-700 text-sm rounded">{message}</div>}
      {error && <div className="p-3 bg-red-100 text-red-700 text-sm rounded">{error}</div>}

      <form onSubmit={handleCreate} className="bg-white p-5 border rounded-lg shadow-sm space-y-3">
        <h2 className="text-lg font-semibold text-gray-800">New Note / Class Plan</h2>
        <div className="grid grid-cols-2 gap-3">
          <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} required className="p-2 border text-sm rounded bg-white">
            <option value="">Select class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} className="p-2 border text-sm rounded bg-white">
            <option value="">Subject (optional)</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <input type="text" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required className="w-full p-2 border text-sm rounded" />
        <textarea placeholder="Note / homework text" value={form.body_text} onChange={(e) => setForm({ ...form, body_text: e.target.value })} rows={3} className="w-full p-2 border text-sm rounded" />
        <input type="text" placeholder="Attachment URL (optional, e.g. PDF link)" value={form.attachment_url} onChange={(e) => setForm({ ...form, attachment_url: e.target.value })} className="w-full p-2 border text-sm rounded" />
        <button type="submit" className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium">Create Note</button>
      </form>

      <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-gray-500">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-700 uppercase">
            <tr>
              <th className="p-3">Title</th>
              <th className="p-3">By</th>
              <th className="p-3">Delivery</th>
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {notes.map((n) => (
              <tr key={n.id}>
                <td className="p-3 font-medium text-gray-900">{n.title}</td>
                <td className="p-3">{n.teacher_name}</td>
                <td className="p-3 text-xs">
                  {n.sent_at
                    ? Object.entries(n.delivery_counts).map(([status, count]) => `${status}: ${count}`).join(', ') || 'No parents'
                    : 'Not sent yet'}
                </td>
                <td className="p-3 text-right">
                  {!n.sent_at && (
                    <button onClick={() => handleSend(n.id)} className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800 font-medium">
                      Send to Parents
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
