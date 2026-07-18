import React, { useEffect, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { apiRequest } from '../api';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

function CellEditor({ classId, dayOfWeek, period, slot, subjects, teachers, onClose, onSaved }) {
  const [subjectId, setSubjectId] = useState(slot?.subject_id || '');
  const [teacherId, setTeacherId] = useState(slot?.teacher_id || '');
  const [room, setRoom] = useState(slot?.room || '');
  const [startTime, setStartTime] = useState(slot?.start_time?.slice(0, 5) || '');
  const [endTime, setEndTime] = useState(slot?.end_time?.slice(0, 5) || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/timetable/slot', {
        method: 'PUT',
        body: {
          class_id: classId,
          day_of_week: dayOfWeek,
          period_number: period,
          subject_id: subjectId || null,
          teacher_id: teacherId || null,
          room: room || null,
          start_time: startTime || null,
          end_time: endTime || null,
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!slot) return onClose();
    setSaving(true);
    try {
      await apiRequest(`/api/timetable/slot/${slot.id}`, { method: 'DELETE' });
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
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-display text-base text-ink">{DAYS[dayOfWeek - 1]} · Period {period}</div>
          <button onClick={onClose}><X className="w-4 h-4 text-ink-soft" /></button>
        </div>
        {error && <div className="rounded-lg bg-rose-50 text-rose-700 text-xs px-3 py-2">{error}</div>}
        <label className="text-sm text-ink-soft space-y-1 block">
          Subject
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink">
            <option value="">— none —</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-sm text-ink-soft space-y-1 block">
          Teacher
          <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink">
            <option value="">— none —</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-ink-soft space-y-1">
            Start
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
          </label>
          <label className="text-sm text-ink-soft space-y-1">
            End
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
          </label>
        </div>
        <label className="text-sm text-ink-soft space-y-1 block">
          Room
          <input value={room} onChange={(e) => setRoom(e.target.value)} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
        </label>
        <div className="flex gap-2 pt-1">
          <button disabled={saving} onClick={save} className="flex-1 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
            Save
          </button>
          {slot && (
            <button disabled={saving} onClick={clear} className="px-4 py-2 rounded-lg bg-white border border-cream-deep text-ink text-sm font-medium hover:bg-cream-deep/40 disabled:opacity-50">
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminTimetable() {
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [classId, setClassId] = useState('');
  const [slots, setSlots] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiRequest('/api/academics/classes').catch(() => []),
      apiRequest('/api/academics/subjects').catch(() => []),
      apiRequest('/api/academics/teachers').catch(() => []),
    ]).then(([c, s, t]) => {
      setClasses(c);
      setSubjects(s);
      setTeachers(t);
      if (c[0]) setClassId(String(c[0].id));
    });
  }, []);

  const loadSlots = async (cid) => {
    if (!cid) return;
    setError('');
    try {
      const data = await apiRequest(`/api/timetable/class/${cid}`);
      setSlots(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (classId) loadSlots(classId);
  }, [classId]);

  const slotFor = (day, period) => slots.find((s) => s.day_of_week === day && s.period_number === period);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-ink flex items-center gap-2">
            <CalendarClock className="w-7 h-7 text-terracotta" /> Timetable
          </h1>
          <p className="text-sm text-ink-soft mt-1">Tap a cell to assign subject, teacher and room.</p>
        </div>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className="rounded-lg border border-cream-deep/70 px-3 py-2 text-ink bg-white">
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && <div className="rounded-xl bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-cream-deep/70 bg-white">
        <table className="w-full text-sm border-collapse min-w-[720px]">
          <thead>
            <tr>
              <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-3 py-3 bg-cream-deep/40 w-24">Period</th>
              {DAYS.map((d) => (
                <th key={d} className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-3 py-3 bg-cream-deep/40">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERIODS.map((p) => (
              <tr key={p} className="border-t border-cream-deep/50">
                <td className="px-3 py-3 text-ink-soft font-medium">P{p}</td>
                {DAYS.map((_, dIdx) => {
                  const day = dIdx + 1;
                  const slot = slotFor(day, p);
                  return (
                    <td key={day} className="px-2 py-2 align-top">
                      <button
                        onClick={() => setEditing({ day, period: p })}
                        className={`w-full text-left rounded-lg px-2.5 py-2 border transition ${
                          slot?.subject_name
                            ? 'bg-terracotta/10 border-terracotta/30 hover:bg-terracotta/20'
                            : 'border-dashed border-cream-deep hover:bg-cream-deep/30'
                        }`}
                      >
                        {slot?.subject_name ? (
                          <>
                            <div className="text-ink font-medium">{slot.subject_name}</div>
                            <div className="text-xs text-ink-soft">{slot.teacher_name || '—'}{slot.room ? ` · ${slot.room}` : ''}</div>
                          </>
                        ) : (
                          <span className="text-xs text-ink-soft">+ Add</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <CellEditor
          classId={classId}
          dayOfWeek={editing.day}
          period={editing.period}
          slot={slotFor(editing.day, editing.period)}
          subjects={subjects}
          teachers={teachers}
          onClose={() => setEditing(null)}
          onSaved={() => loadSlots(classId)}
        />
      )}
    </div>
  );
}
