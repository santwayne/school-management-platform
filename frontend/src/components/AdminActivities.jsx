import React, { useEffect, useState } from 'react';
import { Plus, X, Upload, Users, School, User as UserIcon } from 'lucide-react';
import { apiRequest, apiUpload } from '../api';

const SCOPES = [
  { value: 'all', label: 'All Parents', icon: Users },
  { value: 'class', label: 'By Class', icon: School },
  { value: 'individual', label: 'Select Students', icon: UserIcon },
];

function ComposeForm({ classes, students, onCreated, onClose }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [activityDate, setActivityDate] = useState(new Date().toISOString().slice(0, 10));
  const [scope, setScope] = useState('all');
  const [classId, setClassId] = useState('');
  const [studentIds, setStudentIds] = useState([]);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleStudent = (id) => {
    setStudentIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const submit = async () => {
    if (!title) return setError('Title is required');
    setSaving(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('activity_date', activityDate);
      formData.append('visibility_scope', scope);
      if (scope === 'class') formData.append('class_id', classId);
      if (scope === 'individual') formData.append('student_ids', JSON.stringify(studentIds));
      files.forEach((f) => formData.append('media', f));

      const created = await apiUpload('/api/activities', formData);
      onCreated(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-cream rounded-2xl border border-cream-deep shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl text-ink">Create Activity</h2>
          <button onClick={onClose}><X size={20} className="text-ink-soft" /></button>
        </div>

        {error && <div className="text-sm text-terracotta-deep">{error}</div>}

        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-cream-deep bg-white text-sm"
        />
        <textarea
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-xl border border-cream-deep bg-white text-sm"
        />
        <input
          type="date"
          value={activityDate}
          onChange={(e) => setActivityDate(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-cream-deep bg-white text-sm"
        />

        <div>
          <div className="text-xs text-ink-soft mb-1.5">Send to</div>
          <div className="flex gap-2 flex-wrap">
            {SCOPES.map((s) => (
              <button
                key={s.value}
                onClick={() => setScope(s.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  scope === s.value ? 'bg-terracotta text-white border-terracotta' : 'bg-white text-ink-soft border-cream-deep'
                }`}
              >
                <s.icon size={13} /> {s.label}
              </button>
            ))}
          </div>
        </div>

        {scope === 'class' && (
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-cream-deep bg-white text-sm">
            <option value="">Select a class…</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        {scope === 'individual' && (
          <div className="max-h-40 overflow-y-auto border border-cream-deep rounded-xl divide-y divide-cream-deep/60">
            {students.map((s) => (
              <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-cream-deep/30">
                <input type="checkbox" checked={studentIds.includes(s.id)} onChange={() => toggleStudent(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        )}

        <div>
          <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-cream-deep text-sm text-ink-soft cursor-pointer hover:bg-cream-deep/20">
            <Upload size={16} />
            {files.length ? `${files.length} file(s) selected` : 'Upload photos/videos'}
            <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          </label>
        </div>

        <button
          onClick={submit}
          disabled={saving}
          className="w-full py-2.5 rounded-xl bg-terracotta text-white font-medium text-sm hover:bg-terracotta-deep transition disabled:opacity-50"
        >
          {saving ? 'Sending…' : 'Create & Share'}
        </button>
      </div>
    </div>
  );
}

export default function AdminActivities() {
  const [activities, setActivities] = useState(null);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState('');

  const load = () => apiRequest('/api/activities').then(setActivities).catch((err) => setError(err.message));

  useEffect(() => {
    load();
    apiRequest('/api/academics/classes').then(setClasses).catch(() => {});
    apiRequest('/api/academics/students').then(setStudents).catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink">Activities</h1>
        <button
          onClick={() => setComposing(true)}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-lg bg-terracotta text-white hover:bg-terracotta-deep transition"
        >
          <Plus size={16} /> Create Activity
        </button>
      </div>

      {error && <div className="text-sm text-terracotta-deep">{error}</div>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {activities?.map((a) => (
          <div key={a.id} className="rounded-2xl bg-white border border-cream-deep/70 p-4">
            <div className="text-xs text-ink-soft">{new Date(a.activity_date).toLocaleDateString('en-IN')}</div>
            <h2 className="font-display text-base text-ink mt-0.5">{a.title}</h2>
            <p className="text-xs text-ink-soft mt-1">{a.recipient_count} recipient(s) · {a.media?.length || 0} media file(s)</p>
            {a.failed_uploads?.length > 0 && (
              <p className="text-xs text-terracotta-deep mt-1">{a.failed_uploads.length} upload(s) failed — retry needed</p>
            )}
          </div>
        ))}
        {activities?.length === 0 && <p className="text-sm text-ink-soft">No activities yet.</p>}
      </div>

      {composing && (
        <ComposeForm
          classes={classes}
          students={students}
          onClose={() => setComposing(false)}
          onCreated={() => { setComposing(false); load(); }}
        />
      )}
    </div>
  );
}
