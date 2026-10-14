import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { User, Phone, Mail, Droplet, MapPin, Cake, Upload, Hash, FileText, Trash2, Paperclip, Brain } from 'lucide-react';
import { apiRequest, apiUpload, apiOpenFile } from '../api';
import { useAuth } from '../AuthContext';

const HUB_LINKS = [
  { label: 'Attendance', to: (id) => `/admin/attendance?student=${id}` },
  { label: 'Fees', to: (id) => `/admin/billing?student=${id}` },
  { label: 'Exam Results', to: (id) => `/admin/grading?student=${id}` },
  { label: 'Transport', to: (id) => `/admin/transport?student=${id}` },
  { label: 'Activities', to: (id) => `/admin/activities?student=${id}` },
];

const AVATAR_SIZES = {
  14: 'w-14 h-14',
  20: 'w-20 h-20',
};

function Avatar({ url, name, size = 20 }) {
  // Tailwind's JIT compiler scans source for literal class strings — a
  // template literal like `w-${size}` never resolves to a real utility
  // class at build time, so sizes must be full literal strings, not
  // interpolated. See AVATAR_SIZES above.
  const sizeClasses = AVATAR_SIZES[size] || AVATAR_SIZES[20];
  return url ? (
    <img
      src={url}
      alt={name}
      className={`${sizeClasses} rounded-full object-cover border-2 border-cream-deep`}
    />
  ) : (
    <div
      className={`${sizeClasses} rounded-full bg-cream-deep flex items-center justify-center text-ink-soft font-display text-2xl`}
    >
      {(name || '?').charAt(0).toUpperCase()}
    </div>
  );
}

function Field({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={16} className="text-terracotta mt-0.5 shrink-0" />
      <div>
        <div className="text-xs text-ink-soft">{label}</div>
        <div className="text-sm text-ink font-medium">{value || '—'}</div>
      </div>
    </div>
  );
}

const INR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const STATUS_STYLE = {
  paid: 'bg-emerald-500/10 text-emerald-700',
  unpaid: 'bg-terracotta/15 text-terracotta-deep',
  not_configured: 'bg-cream-deep text-ink-soft',
};
const STATUS_LABEL = { paid: 'Paid', unpaid: 'Unpaid', not_configured: 'No fee set for this class' };

// Fee structure with paid / unpaid status for this academic year.
function FeesPanel({ studentId }) {
  const [fees, setFees] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest(`/api/profiles/students/${studentId}/fees`).then(setFees).catch((err) => setError(err.message));
  }, [studentId]);

  if (error) return <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 text-sm text-ink-soft">Fees: {error}</div>;
  if (!fees) return <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 text-sm text-ink-soft">Loading fees…</div>;
  const t = fees.tuition;
  const yr = new Date(fees.academic_year_start).getFullYear();

  return (
    <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-display text-lg text-ink">Fee structure & status <span className="text-xs text-ink-soft font-sans">({yr}–{String(yr + 1).slice(2)})</span></h2>
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        {[['Fee', t.configured ? INR(t.structure_amount) : '—'], ['Paid', INR(t.paid)], ['Unpaid', t.configured ? INR(t.due) : '—']].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-cream-deep/40 py-3">
            <div className="text-xs text-ink-soft">{label}</div>
            <div className="text-lg font-semibold text-ink">{value}</div>
          </div>
        ))}
      </div>

      {fees.transport.rows.length > 0 && (
        <div>
          <div className="text-xs text-ink-soft mb-1">Transport</div>
          <div className="divide-y divide-cream-deep/60 border border-cream-deep/70 rounded-xl overflow-hidden">
            {fees.transport.rows.map((r) => (
              <div key={r.billing_month} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{r.billing_month}{r.pickup_point ? <span className="text-xs text-ink-soft"> · {r.pickup_point}</span> : null}</span>
                <span className="flex items-center gap-2">
                  {INR(r.monthly_fee)}
                  <span className={`px-2 py-0.5 rounded-full text-xs ${r.collection_status === 'collected' ? STATUS_STYLE.paid : STATUS_STYLE.unpaid}`}>
                    {r.collection_status === 'collected' ? 'Paid' : 'Unpaid'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {fees.total_due > 0 && <div className="text-sm text-ink">Total unpaid (tuition + transport): <strong>{INR(fees.total_due)}</strong></div>}

      <div>
        <div className="text-xs text-ink-soft mb-1">Payments this year</div>
        {fees.payments.length === 0 ? (
          <div className="text-sm text-ink-soft">No payments recorded yet.</div>
        ) : (
          <div className="divide-y divide-cream-deep/60 border border-cream-deep/70 rounded-xl overflow-hidden">
            {fees.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-ink-soft">{new Date(p.created_at).toLocaleDateString('en-IN')} · {p.payment_mode}</span>
                <span className="font-medium text-ink">{INR(p.amount_paid)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Supporting documents: photos, certificates, ID proofs.
function DocumentsPanel({ studentId, canEdit }) {
  const [docs, setDocs] = useState(null);
  const [types, setTypes] = useState([]);
  const [docType, setDocType] = useState('id_proof');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    apiRequest(`/api/profiles/students/${studentId}/documents`).then(setDocs).catch((err) => { setDocs([]); setError(err.message); });

  useEffect(() => {
    load();
    apiRequest('/api/profiles/student-document-types').then(setTypes).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const label = (v) => types.find((t) => t.value === v)?.label || v;

  const upload = async (e) => {
    e.preventDefault();
    if (!file) return setError('Choose a file first.');
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('doc_type', docType);
      fd.append('title', title);
      fd.append('file', file);
      await apiUpload(`/api/profiles/students/${studentId}/documents`, fd);
      setFile(null);
      setTitle('');
      e.target.reset();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const open = (d) => apiOpenFile(`/api/profiles/students/${studentId}/documents/${d.id}/file`).catch((err) => setError(err.message));

  const remove = async (d) => {
    if (!window.confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
    setError('');
    try {
      await apiRequest(`/api/profiles/students/${studentId}/documents/${d.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-3">
      <h2 className="font-display text-lg text-ink">Documents & proofs</h2>
      {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs px-3 py-2">{error}</div>}

      {docs === null ? (
        <div className="text-sm text-ink-soft">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="text-sm text-ink-soft">No documents uploaded yet.</div>
      ) : (
        <div className="divide-y divide-cream-deep/60 border border-cream-deep/70 rounded-xl overflow-hidden">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-3 py-2.5">
              <FileText className="w-4 h-4 text-terracotta shrink-0" />
              <button type="button" onClick={() => open(d)} className="min-w-0 text-left">
                <div className="text-sm font-medium text-ink truncate hover:underline">{d.title}</div>
                <div className="text-xs text-ink-soft">{label(d.doc_type)} · {new Date(d.created_at).toLocaleDateString('en-IN')} · {Math.max(1, Math.round(d.size_bytes / 1024))} KB</div>
              </button>
              {canEdit && (
                <button type="button" onClick={() => remove(d)} className="ml-auto p-1.5 text-ink-soft hover:text-destructive" aria-label={`Delete ${d.title}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <form onSubmit={upload} className="grid sm:grid-cols-[1fr_1fr] gap-2 pt-1">
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-lg border border-cream-deep px-3 py-2 text-sm bg-white">
            {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" maxLength={255} className="rounded-lg border border-cream-deep px-3 py-2 text-sm" />
          <label className="sm:col-span-2 flex items-center gap-2 rounded-lg border border-dashed border-cream-deep px-3 py-2 text-sm text-ink-soft cursor-pointer hover:bg-cream-deep/30">
            <Paperclip className="w-4 h-4" />
            <span className="truncate">{file ? file.name : 'Choose a JPG, PNG, WebP or PDF (max 8 MB)'}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <button disabled={busy || !file} className="sm:col-span-2 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
            {busy ? 'Uploading…' : 'Upload document'}
          </button>
        </form>
      )}
    </div>
  );
}

// What the AI Home Tutor has learned about this student over their sessions —
// the staff view. Teachers can correct it (one item per line) or clear it.
function LearningPanel({ studentId, canEdit }) {
  const [p, setP] = useState(undefined);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const lines = (v) => (v || []).join('\n');
  const split = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);

  const load = () => apiRequest(`/api/profiles/students/${studentId}/learning`).then(setP).catch((e) => { setError(e.message); setP(null); });
  useEffect(() => { load(); }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = () => setForm({ summary: p?.summary || '', engagement: p?.engagement || '', strengths: lines(p?.strengths), struggles: lines(p?.struggles), interests: lines(p?.interests), next_steps: lines(p?.next_steps) });
  const save = async () => {
    setError('');
    try {
      await apiRequest(`/api/profiles/students/${studentId}/learning`, { method: 'PUT', body: { ...form, strengths: split(form.strengths), struggles: split(form.struggles), interests: split(form.interests), next_steps: split(form.next_steps) } });
      setForm(null);
      load();
    } catch (e) { setError(e.message); }
  };
  const clear = async () => {
    if (!window.confirm('Clear everything the AI tutor has learned about this student? It will start fresh.')) return;
    await apiRequest(`/api/profiles/students/${studentId}/learning`, { method: 'DELETE' }).catch((e) => setError(e.message));
    load();
  };

  const Block = ({ label, items }) => items?.length ? (
    <div><div className="text-xs text-ink-soft">{label}</div><ul className="list-disc ml-4 text-sm text-ink space-y-0.5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
  ) : null;

  return (
    <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-display text-lg text-ink flex items-center gap-2"><Brain className="w-5 h-5 text-terracotta" /> What the AI tutor knows</h2>
        {canEdit && !form && (
          <div className="flex gap-3 text-xs">
            <button onClick={startEdit} className="text-terracotta-deep font-medium hover:underline">{p ? 'Correct' : 'Add notes'}</button>
            {p && <button onClick={clear} className="text-ink-soft hover:text-destructive">Clear</button>}
          </div>
        )}
      </div>
      {error && <div className="text-xs text-destructive">{error}</div>}
      {p === undefined ? <div className="text-sm text-ink-soft">Loading…</div> : form ? (
        <div className="space-y-2 text-sm">
          {[['summary', 'Summary'], ['engagement', 'How they learn'], ['strengths', 'Strengths (one per line)'], ['struggles', 'Finds difficult (one per line)'], ['interests', 'Interests (one per line)'], ['next_steps', 'What would help next (one per line)']].map(([k, label]) => (
            <label key={k} className="block"><span className="text-xs text-ink-soft">{label}</span>
              <textarea rows={k === 'summary' || k === 'engagement' ? 2 : 3} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1 w-full rounded-lg border border-cream-deep px-3 py-2" />
            </label>
          ))}
          <div className="flex gap-2"><button onClick={save} className="px-4 py-1.5 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium">Save</button><button onClick={() => setForm(null)} className="px-3 py-1.5 text-sm text-ink-soft">Cancel</button></div>
        </div>
      ) : !p ? (
        <p className="text-sm text-ink-soft">Nothing yet. It builds up automatically as this student uses the AI Tutor, and the tutor uses it to help them better.</p>
      ) : (
        <div className="space-y-3">
          {p.summary && <p className="text-sm text-ink">{p.summary}</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            <Block label="Strengths" items={p.strengths} />
            <Block label="Finds difficult" items={p.struggles} />
            <Block label="Interests" items={p.interests} />
            <Block label="What would help next" items={p.next_steps} />
          </div>
          {p.engagement && <div><div className="text-xs text-ink-soft">How they learn</div><p className="text-sm text-ink">{p.engagement}</p></div>}
          <p className="text-[11px] text-ink-soft">Built from {p.sessions_reviewed} tutoring review{p.sessions_reviewed === 1 ? '' : 's'}, teacher notes and exam marks. Learning only — a teacher can correct anything here.</p>
        </div>
      )}
    </div>
  );
}

export default function StudentProfile() {
  const { studentId } = useParams();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setError('');
    try {
      const data = await apiRequest(`/api/profiles/students/${studentId}`);
      setProfile(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    setProfile(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('photo', file);
      await apiUpload(`/api/profiles/students/${studentId}/photo`, formData);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  if (error) return <div className="p-6 text-terracotta-deep">{error}</div>;
  if (!profile) return <div className="p-6 text-ink-soft">Loading profile…</div>;

  const father = profile.parents?.find((p) => p.relation === 'father');
  const mother = profile.parents?.find((p) => p.relation === 'mother');
  const guardians = profile.parents?.filter((p) => p.relation === 'guardian') || [];

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 flex items-center gap-5">
        <div className="relative">
          <Avatar url={profile.photo_url} name={profile.name} size={20} />
          <label className="absolute -bottom-1 -right-1 bg-terracotta text-cream rounded-full p-1.5 cursor-pointer shadow">
            <Upload size={12} />
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} disabled={uploading} />
          </label>
        </div>
        <div>
          <h1 className="font-display text-2xl text-ink">{profile.name}</h1>
          <p className="text-sm text-ink-soft">
            {profile.class_name || 'Unassigned class'}
            {profile.admission_date && ` · Admitted ${new Date(profile.admission_date).toLocaleDateString()}`}
          </p>
        </div>
      </div>

      {uploading && <p className="text-xs text-ink-soft">Uploading photo…</p>}

      {/* Basic info */}
      <div className="bg-white rounded-2xl border border-cream-deep/70 p-5">
        <h2 className="font-display text-lg text-ink mb-4">Basic Info</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field icon={Cake} label="Date of Birth" value={profile.date_of_birth && new Date(profile.date_of_birth).toLocaleDateString()} />
          <Field icon={User} label="Gender" value={profile.gender} />
          <Field icon={Droplet} label="Blood Group" value={profile.blood_group} />
          <Field icon={Phone} label="Emergency Contact" value={profile.emergency_contact_phone} />
          <Field icon={MapPin} label="Address" value={[profile.address?.line1, profile.address?.city, profile.address?.state, profile.address?.pincode].filter(Boolean).join(', ')} />
          <Field icon={Hash} label="Admission No." value={profile.admission_number} />
          <Field icon={Hash} label="Login ID" value={profile.login_id} />
        </div>
        {profile.medical_notes !== undefined && (
          <div className="mt-4 pt-4 border-t border-cream-deep">
            <div className="text-xs text-ink-soft mb-1">Medical Notes</div>
            <div className="text-sm text-ink">{profile.medical_notes || 'None recorded'}</div>
          </div>
        )}
      </div>

      {/* Parents */}
      <div className="bg-white rounded-2xl border border-cream-deep/70 p-5">
        <h2 className="font-display text-lg text-ink mb-4">Parents / Guardian</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[father, mother, ...guardians].filter(Boolean).map((p) => (
            <div key={p.id} className="flex items-center gap-3 bg-cream-deep/40 rounded-xl p-3">
              <Avatar url={p.photo_url} name={p.name} size={14} />
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink capitalize">{p.name} <span className="text-xs text-ink-soft">({p.relation})</span></div>
                {p.occupation && <div className="text-xs text-ink-soft">{p.occupation}</div>}
                {p.phone && (
                  <div className="text-xs text-ink-soft flex items-center gap-1"><Phone size={10} />{p.phone}</div>
                )}
                {p.email && (
                  <div className="text-xs text-ink-soft flex items-center gap-1 truncate"><Mail size={10} />{p.email}</div>
                )}
              </div>
            </div>
          ))}
          {!profile.parents?.length && <p className="text-sm text-ink-soft">No parent/guardian records yet.</p>}
        </div>
      </div>

      <FeesPanel studentId={studentId} />

      {profile.medical_notes !== undefined && user?.role !== 'student' && (
        <LearningPanel studentId={studentId} canEdit={['principal', 'teacher'].includes(user?.role)} />
      )}

      {profile.medical_notes !== undefined && (
        <DocumentsPanel studentId={studentId} canEdit={['principal', 'teacher'].includes(user?.role)} />
      )}

      {/* Hub links */}
      <div className="flex flex-wrap gap-2">
        {HUB_LINKS.map((l) => (
          <Link
            key={l.label}
            to={l.to(studentId)}
            className="px-4 py-2 rounded-lg bg-white border border-cream-deep text-ink text-sm font-medium hover:bg-cream-deep/40 transition"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
