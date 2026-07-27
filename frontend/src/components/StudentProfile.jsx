import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { User, Phone, Mail, Droplet, MapPin, Cake, Upload } from 'lucide-react';
import { apiRequest, apiUpload } from '../api';

const HUB_LINKS = [
  { label: 'Attendance', to: (id) => `/admin/attendance?student=${id}` },
  { label: 'Fees', to: (id) => `/admin/billing?student=${id}` },
  { label: 'Exam Results', to: (id) => `/admin/grading?student=${id}` },
  { label: 'Transport', to: (id) => `/admin/transport?student=${id}` },
  { label: 'Activities', to: (id) => `/admin/activities?student=${id}` },
];

function Avatar({ url, name, size = 20 }) {
  return url ? (
    <img
      src={url}
      alt={name}
      className={`w-${size} h-${size} rounded-full object-cover border-2 border-cream-deep`}
    />
  ) : (
    <div
      className={`w-${size} h-${size} rounded-full bg-cream-deep flex items-center justify-center text-ink-soft font-display text-2xl`}
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

export default function StudentProfile() {
  const { studentId } = useParams();
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
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="bg-cream rounded-2xl border border-cream-deep p-5 flex items-center gap-5">
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
      <div className="bg-cream rounded-2xl border border-cream-deep p-5">
        <h2 className="font-display text-lg text-ink mb-4">Basic Info</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field icon={Cake} label="Date of Birth" value={profile.date_of_birth && new Date(profile.date_of_birth).toLocaleDateString()} />
          <Field icon={User} label="Gender" value={profile.gender} />
          <Field icon={Droplet} label="Blood Group" value={profile.blood_group} />
          <Field icon={Phone} label="Emergency Contact" value={profile.emergency_contact_phone} />
          <Field icon={MapPin} label="Address" value={profile.address?.line1 || profile.address?.city} />
        </div>
        {profile.medical_notes !== undefined && (
          <div className="mt-4 pt-4 border-t border-cream-deep">
            <div className="text-xs text-ink-soft mb-1">Medical Notes</div>
            <div className="text-sm text-ink">{profile.medical_notes || 'None recorded'}</div>
          </div>
        )}
      </div>

      {/* Parents */}
      <div className="bg-cream rounded-2xl border border-cream-deep p-5">
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

      {/* Hub links */}
      <div className="flex flex-wrap gap-2">
        {HUB_LINKS.map((l) => (
          <Link
            key={l.label}
            to={l.to(studentId)}
            className="px-4 py-2 rounded-full bg-ink text-cream text-sm font-medium hover:bg-ink-soft transition-colors"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
