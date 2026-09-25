import React, { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { apiRequest } from '../../api';
import { PageTitle, ErrorBanner, Notice, formatDateTime } from './admissionsUi';

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function VisitSlots() {
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ from: todayPlus(1), to: todayPlus(7), times: '10:00,11:00,15:00', duration: 30, capacity: 3, days: [1, 2, 3, 4, 5, 6] });

  const load = useCallback(() => {
    apiRequest('/api/admissions/slots').then(setSlots).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const toggleDay = (d) => setForm((p) => ({ ...p, days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d] }));

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const dates = [];
      const cur = new Date(form.from);
      const end = new Date(form.to);
      while (cur <= end) {
        if (form.days.includes(cur.getDay())) dates.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
      }
      const times = form.times.split(',').map((t) => t.trim()).filter(Boolean);
      const r = await apiRequest('/api/admissions/slots', {
        method: 'POST',
        body: { dates, times, duration_minutes: Number(form.duration), capacity: Number(form.capacity) },
      });
      setNotice(`Created ${r.created} slot${r.created === 1 ? '' : 's'}.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this slot?')) return;
    try {
      await apiRequest(`/api/admissions/slots/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-5">
      <PageTitle title="Campus visit slots" subtitle="Families book these directly through the admissions bot." />
      <ErrorBanner message={error} />
      <Notice message={notice} />

      <form onSubmit={create} className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-4">
        <h2 className="font-display text-lg text-ink">Bulk create</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block text-sm"><span className="text-ink-soft">From</span>
            <input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" /></label>
          <label className="block text-sm"><span className="text-ink-soft">To</span>
            <input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" /></label>
        </div>
        <div>
          <span className="text-sm text-ink-soft">On these days</span>
          <div className="flex gap-1.5 mt-1.5">
            {dayNames.map((n, i) => (
              <button type="button" key={i} onClick={() => toggleDay(i)} className={`w-10 h-9 rounded-lg text-xs font-medium ${form.days.includes(i) ? 'bg-terracotta text-white' : 'bg-cream-deep/50 text-ink-soft'}`}>{n}</button>
            ))}
          </div>
        </div>
        <label className="block text-sm"><span className="text-ink-soft">Times (comma-separated, 24h)</span>
          <input value={form.times} onChange={(e) => setForm({ ...form, times: e.target.value })} placeholder="10:00, 11:00, 15:00" className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" /></label>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block text-sm"><span className="text-ink-soft">Slot length (minutes)</span>
            <input type="number" min="10" max="240" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" /></label>
          <label className="block text-sm"><span className="text-ink-soft">Families per slot</span>
            <input type="number" min="1" max="50" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" /></label>
        </div>
        <button disabled={busy} className="px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
          {busy ? 'Creating…' : 'Create slots'}
        </button>
      </form>

      <div className="bg-white rounded-2xl border border-cream-deep/70 overflow-x-auto">
        {!slots ? (
          <p className="px-5 py-8 text-sm text-ink-soft text-center">Loading…</p>
        ) : slots.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-soft text-center">No upcoming slots — create some above.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-soft">
              <tr className="border-b border-cream-deep/60">
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 font-medium">Booked</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.id} className="border-b border-cream-deep/40 last:border-0">
                  <td className="px-5 py-3 text-ink">{formatDateTime(s.slot_start)}</td>
                  <td className="px-5 py-3 text-ink-soft">{s.booked} / {s.capacity}</td>
                  <td className="px-5 py-3 text-right">
                    {s.booked === 0 && (
                      <button onClick={() => remove(s.id)} className="text-ink-soft hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
