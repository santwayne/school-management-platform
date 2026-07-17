import React, { useState } from 'react';
import { apiRequest } from '../api';

export default function StaffBroadcast() {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setSending(true);
    try {
      const data = await apiRequest('/api/staff-broadcast', { method: 'POST', body: { message } });
      setResult(data);
      setMessage('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">Staff Broadcast</h1>
      <p className="text-sm text-ink-soft">Sends a WhatsApp message to every teacher who has opted in — not everyone gets this automatically.</p>

      {error && <div className="p-3 bg-red-100 text-destructive text-sm rounded">{error}</div>}
      {result && (
        <div className="p-3 bg-green-100 text-green-700 text-sm rounded">
          Sent to {result.sent_to} of {result.total_opted_in} opted-in teachers.
        </div>
      )}

      <form onSubmit={handleSend} className="bg-white p-5 border rounded-lg shadow-sm space-y-3">
        <textarea
          placeholder="e.g. Staff meeting at 4pm in the main hall today."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          rows={4}
          className="w-full p-2 border text-sm rounded"
        />
        <button type="submit" disabled={sending} className="w-full py-2 bg-terracotta hover:bg-terracotta-deep text-white rounded text-sm font-medium disabled:opacity-50">
          {sending ? 'Sending...' : 'Send to Opted-In Teachers'}
        </button>
      </form>
    </div>
  );
}
