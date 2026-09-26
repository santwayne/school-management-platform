import React, { useEffect, useState } from 'react';
import { Sparkles, Save, Trash2, Plus, CheckCircle2, Wand2 } from 'lucide-react';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ConfigPanel({ classes, subjects, teachers }) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const [reqs, setReqs] = useState(null);
  const [unavail, setUnavail] = useState(null);
  const [newUnavail, setNewUnavail] = useState({ teacher_id: '', day_of_week: 1, period_number: 1 });
  const [rooms, setRooms] = useState(null);
  const [newRoom, setNewRoom] = useState({ name: '', room_type: 'classroom' });
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);

  const loadAll = () => {
    apiRequest('/api/timetable-generator/config').then(setConfig).catch((e) => setError(e.message));
    apiRequest('/api/timetable-generator/requirements').then(setReqs).catch((e) => setError(e.message));
    apiRequest('/api/timetable-generator/unavailability').then(setUnavail).catch((e) => setError(e.message));
    apiRequest('/api/timetable-generator/rooms').then(setRooms).catch((e) => setError(e.message));
  };
  useEffect(() => { loadAll(); }, []);

  const addRoom = async () => {
    if (!newRoom.name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/timetable-generator/rooms', { method: 'POST', body: newRoom });
      setNewRoom({ name: '', room_type: 'classroom' });
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const removeRoom = async (id) => {
    try {
      await apiRequest(`/api/timetable-generator/rooms/${id}`, { method: 'DELETE' });
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  // Best-effort name -> id matching for whatever the AI parse couldn't
  // already resolve server-side (it only sees names as of when it ran;
  // this re-checks against the freshest lists in state).
  const matchByLabel = (list, text) => {
    if (!text) return '';
    const hit = list.find((x) => (x.label || x.name || '').toLowerCase() === String(text).toLowerCase());
    return hit ? hit.id : '';
  };

  const parseWithAi = async () => {
    if (!pasteText.trim()) return;
    setParsing(true);
    setError('');
    try {
      const { items } = await apiRequest('/api/timetable-generator/parse-requirements-text', { method: 'POST', body: { text: pasteText } });
      const mapped = items.map((it) => ({
        class_id: it.class_id || matchByLabel(classes, it.class_text) || (classes[0]?.id ?? ''),
        subject_id: it.subject_id || matchByLabel(subjects, it.subject_text) || (subjects[0]?.id ?? ''),
        teacher_id: it.teacher_id || matchByLabel(teachers, it.teacher_text) || '',
        room_id: it.room_id || matchByLabel(rooms || [], it.room_text) || '',
        periods_per_week: it.periods_per_week || 5,
        heavy: !!it.heavy,
        _unmatched: (!it.class_id && it.class_text) || (!it.subject_id && it.subject_text) ? 'Check this row — AI could not confidently match everything.' : null,
      }));
      setReqs([...(reqs || []), ...mapped]);
      setPasteText('');
      setNotice(`Added ${mapped.length} row${mapped.length === 1 ? '' : 's'} below — review before saving, especially any marked in amber.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setParsing(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await apiRequest('/api/timetable-generator/config', { method: 'PUT', body: config });
      setConfig(updated);
      setNotice('Saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleDay = (d) => {
    const days = (config.working_days || '').split(',').filter(Boolean).map(Number);
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    setConfig({ ...config, working_days: next.join(',') });
  };

  const addRequirement = () => {
    if (!classes[0] || !subjects[0]) return;
    setReqs([...reqs, { class_id: classes[0].id, subject_id: subjects[0].id, teacher_id: '', room_id: '', periods_per_week: 4, heavy: false }]);
  };
  const updateReq = (i, patch) => setReqs(reqs.map((r, idx) => (idx === i ? { ...r, ...patch, _unmatched: null } : r)));
  const removeReq = (i) => setReqs(reqs.filter((_, idx) => idx !== i));

  const saveReqs = async () => {
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/timetable-generator/requirements', {
        method: 'PUT',
        body: { items: reqs.map((r) => ({ class_id: Number(r.class_id), subject_id: Number(r.subject_id), teacher_id: r.teacher_id || null, room_id: r.room_id || null, periods_per_week: Number(r.periods_per_week), heavy: !!r.heavy })) },
      });
      setNotice('Requirements saved.');
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const seedFromCurrent = async () => {
    setSaving(true);
    setError('');
    try {
      const r = await apiRequest('/api/timetable-generator/requirements/from-current', { method: 'POST' });
      setNotice(`Imported ${r.imported} requirement${r.imported === 1 ? '' : 's'} from the current timetable.`);
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addUnavail = async () => {
    if (!newUnavail.teacher_id) return;
    const items = [...unavail.map((u) => ({ teacher_id: u.teacher_id, day_of_week: u.day_of_week, period_number: u.period_number })), newUnavail];
    setSaving(true);
    try {
      await apiRequest('/api/timetable-generator/unavailability', { method: 'PUT', body: { items } });
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeUnavail = async (idx) => {
    const items = unavail.filter((_, i) => i !== idx).map((u) => ({ teacher_id: u.teacher_id, day_of_week: u.day_of_week, period_number: u.period_number }));
    try {
      await apiRequest('/api/timetable-generator/unavailability', { method: 'PUT', body: { items } });
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!config || !reqs || !unavail) return error ? <div className="text-sm text-destructive">{error}</div> : <p className="text-sm text-ink-soft">Loading…</p>;

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-xl bg-joy-leaf/15 border border-joy-leaf/40 px-4 py-2.5 text-sm text-ink">{notice}</div>}

      <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-3">
        <h2 className="font-display text-lg text-ink">School week</h2>
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-sm">
            <span className="text-ink-soft block">Periods per day</span>
            <input type="number" min="1" max="12" value={config.periods_per_day} onChange={(e) => setConfig({ ...config, periods_per_day: Number(e.target.value) })} className="mt-1 w-20 px-3 py-2 rounded-lg border border-cream-deep" />
          </label>
          <div>
            <span className="text-sm text-ink-soft block mb-1">Working days</span>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button key={d} onClick={() => toggleDay(d)} className={`w-10 h-9 rounded-lg text-xs font-medium ${(config.working_days || '').split(',').map(Number).includes(d) ? 'bg-terracotta text-white' : 'bg-cream-deep/50 text-ink-soft'}`}>{DAY_NAMES[d]}</button>
              ))}
            </div>
          </div>
        </div>
        <button disabled={saving} onClick={saveConfig} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
          <Save className="w-4 h-4" /> Save
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-3">
        <h2 className="font-display text-lg text-ink">Rooms</h2>
        <p className="text-xs text-ink-soft">Optional — only add rooms that are actually a limited resource (a lab, the computer room). Most subjects need none.</p>
        <div className="flex flex-wrap gap-2">
          {(rooms || []).map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-full bg-cream-deep/50 text-sm text-ink">
              {r.name} <span className="text-xs text-ink-soft">({r.room_type})</span>
              <button onClick={() => removeRoom(r.id)} className="text-ink-soft hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
            </span>
          ))}
          {rooms?.length === 0 && <span className="text-sm text-ink-soft">No rooms added yet.</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={newRoom.name} onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })} placeholder="e.g. Science Lab" className="px-2 py-1.5 rounded-lg border border-cream-deep text-sm" />
          <select value={newRoom.room_type} onChange={(e) => setNewRoom({ ...newRoom, room_type: e.target.value })} className="px-2 py-1.5 rounded-lg border border-cream-deep text-sm">
            <option value="classroom">Classroom</option>
            <option value="lab">Lab</option>
            <option value="other">Other</option>
          </select>
          <button disabled={saving} onClick={addRoom} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-deep text-sm text-ink-soft hover:text-ink"><Plus className="w-3.5 h-3.5" /> Add room</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-3">
        <h2 className="font-display text-lg text-ink">Paste requirements, let AI draft the rows</h2>
        <p className="text-xs text-ink-soft">
          e.g. "Class 5 needs Maths 8 periods a week with Mrs Sharma, Science 6 periods in the Science Lab, English 6
          periods." It only ever uses your real classes/subjects/teachers/rooms below — anything it can't match
          confidently comes back blank for you to fix.
        </p>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={4}
          placeholder="Paste or type your requirements in plain English…"
          className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm"
        />
        <button disabled={parsing || !pasteText.trim()} onClick={parseWithAi} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
          <Wand2 className="w-4 h-4" /> {parsing ? 'Parsing…' : 'Parse with AI'}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-display text-lg text-ink">Class requirements</h2>
          <button onClick={seedFromCurrent} className="text-xs text-terracotta-deep hover:underline">Seed from current timetable</button>
        </div>
        <div className="space-y-2">
          {reqs.map((r, i) => (
            <div key={i} className={`flex flex-wrap items-center gap-2 text-sm rounded-lg ${r._unmatched ? 'bg-amber-500/10 p-2 -m-2' : ''}`}>
              <select value={r.class_id} onChange={(e) => updateReq(i, { class_id: e.target.value })} className="px-2 py-1.5 rounded-lg border border-cream-deep">
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={r.subject_id} onChange={(e) => updateReq(i, { subject_id: e.target.value })} className="px-2 py-1.5 rounded-lg border border-cream-deep">
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={r.teacher_id || ''} onChange={(e) => updateReq(i, { teacher_id: e.target.value })} className="px-2 py-1.5 rounded-lg border border-cream-deep">
                <option value="">Any teacher</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={r.room_id || ''} onChange={(e) => updateReq(i, { room_id: e.target.value })} className="px-2 py-1.5 rounded-lg border border-cream-deep">
                <option value="">No room</option>
                {(rooms || []).map((rm) => <option key={rm.id} value={rm.id}>{rm.name}</option>)}
              </select>
              <input type="number" min="1" max="20" value={r.periods_per_week} onChange={(e) => updateReq(i, { periods_per_week: e.target.value })} className="w-16 px-2 py-1.5 rounded-lg border border-cream-deep" title="Periods per week" />
              <label className="flex items-center gap-1 text-xs text-ink-soft"><input type="checkbox" checked={r.heavy} onChange={(e) => updateReq(i, { heavy: e.target.checked })} className="accent-terracotta" /> heavy</label>
              <button onClick={() => removeReq(i)} className="text-ink-soft hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
              {r._unmatched && <span className="text-xs text-amber-700 basis-full">{r._unmatched}</span>}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={addRequirement} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-deep text-sm text-ink-soft hover:text-ink"><Plus className="w-3.5 h-3.5" /> Add row</button>
          <button disabled={saving} onClick={saveReqs} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50"><Save className="w-4 h-4" /> Save requirements</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-3">
        <h2 className="font-display text-lg text-ink">Teacher unavailability</h2>
        <div className="space-y-1.5">
          {unavail.map((u, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-ink">
              <span className="flex-1">{u.teacher_name} — {DAY_NAMES[u.day_of_week]}, period {u.period_number}</span>
              <button onClick={() => removeUnavail(i)} className="text-ink-soft hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {unavail.length === 0 && <p className="text-sm text-ink-soft">Nobody's blocked out yet.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={newUnavail.teacher_id} onChange={(e) => setNewUnavail({ ...newUnavail, teacher_id: e.target.value })} className="px-2 py-1.5 rounded-lg border border-cream-deep text-sm">
            <option value="">Teacher…</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={newUnavail.day_of_week} onChange={(e) => setNewUnavail({ ...newUnavail, day_of_week: Number(e.target.value) })} className="px-2 py-1.5 rounded-lg border border-cream-deep text-sm">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
          </select>
          <input type="number" min="1" max="12" value={newUnavail.period_number} onChange={(e) => setNewUnavail({ ...newUnavail, period_number: Number(e.target.value) })} className="w-16 px-2 py-1.5 rounded-lg border border-cream-deep text-sm" />
          <button onClick={addUnavail} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-deep text-sm text-ink-soft hover:text-ink"><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
      </div>
    </div>
  );
}

function DraftDetail({ draftId, onBack, onPublished }) {
  const { user } = useAuth();
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    apiRequest(`/api/timetable-generator/drafts/${draftId}`).then(setDraft).catch((e) => setError(e.message));
  }, [draftId]);

  const publish = async () => {
    if (!window.confirm('Publish this draft? It replaces the live timetable.')) return;
    setPublishing(true);
    setError('');
    try {
      const r = await apiRequest(`/api/timetable-generator/drafts/${draftId}/publish`, { method: 'POST' });
      onPublished(`Published — ${r.lessons} lessons live, ${r.teacher_changes} teachers affected.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  if (!draft) return error ? <div className="text-sm text-destructive">{error}</div> : <p className="text-sm text-ink-soft">Loading…</p>;

  const label = (kind, id) => draft.names?.[`${kind}${id}`] || `#${id}`;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-ink-soft hover:text-ink">← All drafts</button>
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-ink-soft">{draft.slots.length} lessons placed · {draft.unplaced.length} unplaced · penalty {draft.penalty}</div>
        {draft.status !== 'published' && user?.role === 'principal' && (
          <button disabled={publishing} onClick={publish} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
            <CheckCircle2 className="w-4 h-4" /> {publishing ? 'Publishing…' : 'Publish'}
          </button>
        )}
        {draft.status !== 'published' && user?.role !== 'principal' && <span className="text-xs text-ink-soft">Only the Principal can publish.</span>}
        {draft.status === 'published' && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700">Published</span>}
      </div>

      {draft.unplaced.length > 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-800">
          Couldn't place: {draft.unplaced.map((u, i) => <span key={i}>{i > 0 && ', '}{label('c', u.class_id)} {label('s', u.subject_id)}</span>)}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-cream-deep/70 overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-soft sticky top-0 bg-white"><tr className="border-b border-cream-deep/60"><th className="px-4 py-2.5">Day</th><th className="px-4 py-2.5">Period</th><th className="px-4 py-2.5">Class</th><th className="px-4 py-2.5">Subject</th><th className="px-4 py-2.5">Teacher</th><th className="px-4 py-2.5">Room</th></tr></thead>
          <tbody>
            {draft.slots.map((s, i) => (
              <tr key={i} className="border-b border-cream-deep/40 last:border-0">
                {/* A draft's slots come straight from solveTimetable()'s own
                    output shape (day/period) — only the published
                    timetable_slots table uses day_of_week/period_number. */}
                <td className="px-4 py-2 text-ink-soft">{DAY_NAMES[s.day]}</td>
                <td className="px-4 py-2 text-ink-soft">P{s.period}</td>
                <td className="px-4 py-2 text-ink">{label('c', s.class_id)}</td>
                <td className="px-4 py-2 text-ink-soft">{label('s', s.subject_id)}</td>
                <td className="px-4 py-2 text-ink-soft">{s.teacher_id ? label('t', s.teacher_id) : '—'}</td>
                <td className="px-4 py-2 text-ink-soft">{s.room_id ? label('rm', s.room_id) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DraftsPanel() {
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = () => apiRequest('/api/timetable-generator/drafts').then(setDrafts).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const generate = async () => {
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const r = await apiRequest('/api/timetable-generator/generate', { method: 'POST' });
      setNotice(`Generated: ${r.placed} placed, ${r.unplaced} unplaced.`);
      await load();
      setSelected(r.draft_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  if (selected) {
    return <DraftDetail draftId={selected} onBack={() => { setSelected(null); load(); }} onPublished={(msg) => { setNotice(msg); setSelected(null); load(); }} />;
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-xl bg-joy-leaf/15 border border-joy-leaf/40 px-4 py-2.5 text-sm text-ink">{notice}</div>}
      <button disabled={generating} onClick={generate} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
        <Sparkles className="w-4 h-4" /> {generating ? 'Generating… (up to 20s)' : 'Generate new draft'}
      </button>
      <div className="bg-white rounded-2xl border border-cream-deep/70 overflow-hidden">
        {!drafts ? (
          <p className="px-5 py-8 text-sm text-ink-soft text-center">Loading…</p>
        ) : drafts.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-soft text-center">No drafts yet — set up requirements, then generate one.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-soft"><tr className="border-b border-cream-deep/60"><th className="px-5 py-3">Created</th><th className="px-5 py-3">Lessons</th><th className="px-5 py-3">Unplaced</th><th className="px-5 py-3">Status</th></tr></thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id} className="border-b border-cream-deep/40 last:border-0 hover:bg-cream/50 cursor-pointer" onClick={() => setSelected(d.id)}>
                  <td className="px-5 py-3 text-ink-soft">{new Date(d.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                  <td className="px-5 py-3 text-ink">{d.lessons}</td>
                  <td className="px-5 py-3 text-ink-soft">{d.unplaced}</td>
                  <td className="px-5 py-3">
                    {d.status === 'published' ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700">Published</span> :
                     d.status === 'backup' ? <span className="px-2 py-0.5 rounded-full text-xs bg-cream-deep/60 text-ink-soft">Backup</span> :
                     <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-700">Draft</span>}
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

export default function TimetableGenerator({ classes, subjects, teachers }) {
  const [sub, setSub] = useState('setup');
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-cream-deep/70">
        {[['setup', 'Setup'], ['generate', 'Generate & Drafts']].map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)} className={`px-4 py-2 text-sm ${sub === k ? 'border-b-2 border-terracotta text-terracotta-deep font-medium' : 'text-ink-soft hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      {sub === 'setup' ? <ConfigPanel classes={classes} subjects={subjects} teachers={teachers} /> : <DraftsPanel />}
    </div>
  );
}
