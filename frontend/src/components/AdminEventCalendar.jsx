import React, { useEffect, useState } from 'react';
import { CalendarDays, Plus, X, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiRequest } from '../api';

const TYPE_STYLES = {
  holiday: 'bg-emerald-500/10 text-emerald-700',
  exam: 'bg-terracotta/15 text-terracotta-deep',
  ptm: 'bg-sky-500/10 text-sky-700',
  sports: 'bg-amber-500/15 text-amber-700',
  general: 'bg-cream-deep text-ink-soft',
  other: 'bg-cream-deep text-ink-soft',
};

function pad(n) { return String(n).padStart(2, '0'); }

function EventForm({ defaultDate, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: '', description: '', event_date: defaultDate, end_date: '', event_type: 'general', audience: 'all',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.title || !form.event_date) {
      setError('Title and date are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/events', { method: 'POST', body: { ...form, end_date: form.end_date || null } });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-display text-base text-ink">New event</div>
          <button onClick={onClose}><X className="w-4 h-4 text-ink-soft" /></button>
        </div>
        {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs px-3 py-2">{error}</div>}
        <input
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
        />
        <textarea
          placeholder="Description (optional)"
          rows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-ink-soft space-y-1">
            Date
            <input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
          </label>
          <label className="text-sm text-ink-soft space-y-1">
            End date (optional)
            <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-ink-soft space-y-1">
            Type
            <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink">
              {Object.keys(TYPE_STYLES).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-sm text-ink-soft space-y-1">
            Audience
            <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink">
              {['all', 'staff', 'students', 'parents'].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>
        <button disabled={saving} onClick={save} className="w-full px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
          {saving ? 'Saving…' : 'Add event'}
        </button>
      </div>
    </div>
  );
}

export default function AdminEventCalendar() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [formDate, setFormDate] = useState(null);

  const from = `${year}-${pad(month + 1)}-01`;
  const toDate = new Date(year, month + 1, 1);
  const to = `${toDate.getFullYear()}-${pad(toDate.getMonth() + 1)}-01`;

  const load = async () => {
    setError('');
    try {
      const data = await apiRequest(`/api/events?from=${from}&to=${to}`);
      setEvents(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    setEvents(null);
    load();
  }, [month, year]);

  const remove = async (id) => {
    try {
      await apiRequest(`/api/events/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const changeMonth = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonth(m);
    setYear(y);
  };

  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = (firstDayOfMonth + 6) % 7; // shift so week starts Monday
  const cells = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const eventsOn = (day) => {
    const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
    return (events || []).filter((e) => e.event_date.slice(0, 10) === dateStr);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-ink flex items-center gap-2">
            <CalendarDays className="w-7 h-7 text-terracotta" /> Events
          </h1>
          <p className="text-sm text-ink-soft mt-1">Holidays, exams, PTMs and school-wide announcements.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => changeMonth(-1)} className="p-2 rounded-lg border border-cream-deep/70 hover:bg-cream-deep/40"><ChevronLeft className="w-4 h-4" /></button>
          <div className="font-medium text-ink w-36 text-center">{new Date(year, month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>
          <button onClick={() => changeMonth(1)} className="p-2 rounded-lg border border-cream-deep/70 hover:bg-cream-deep/40"><ChevronRight className="w-4 h-4" /></button>
          <button
            onClick={() => setFormDate(`${year}-${pad(month + 1)}-${pad(now.getDate())}`)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="rounded-2xl border border-cream-deep/70 bg-white overflow-hidden">
        <div className="grid grid-cols-7 bg-cream-deep/40 text-xs uppercase tracking-wider text-ink-soft">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-2 py-2 text-center">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => (
            <div key={i} className="min-h-[92px] border-t border-l border-cream-deep/50 p-1.5 -ml-px first:ml-0">
              {day && (
                <>
                  <button onClick={() => setFormDate(`${year}-${pad(month + 1)}-${pad(day)}`)} className="text-xs text-ink-soft hover:text-terracotta">
                    {day}
                  </button>
                  <div className="space-y-1 mt-1">
                    {eventsOn(day).map((e) => (
                      <div key={e.id} className={`text-[11px] px-1.5 py-1 rounded-md flex items-center justify-between gap-1 ${TYPE_STYLES[e.event_type] || TYPE_STYLES.general}`}>
                        <span className="truncate">{e.title}</span>
                        <button onClick={() => remove(e.id)} className="opacity-60 hover:opacity-100 shrink-0"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {formDate && <EventForm defaultDate={formDate} onClose={() => setFormDate(null)} onSaved={load} />}
    </div>
  );
}
