import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../api';

// Public, unauthenticated admission enquiry form — embeddable on the
// school's own website, or shared as a direct link. No shell/sidebar:
// this is meant to be seen by prospective parents, not staff.
export default function PublicAdmissionEnquiry() {
  const { slug } = useParams();
  const [school, setSchool] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState({ parent_name: '', phone: '', child_name: '', applying_class: '', consent: false, website: '' });
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    apiRequest(`/api/public/admissions/${slug}`)
      .then(setSchool)
      .catch(() => setNotFound(true));
  }, [slug]);

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      await apiRequest(`/api/public/admissions/${slug}/enquiry`, { method: 'POST', body: form });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (notFound) {
    return <div className="min-h-screen bg-cream flex items-center justify-center text-ink-soft">This admissions page isn't available.</div>;
  }
  if (!school) {
    return <div className="min-h-screen bg-cream flex items-center justify-center text-ink-soft">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-cream font-sans flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-cream-deep/70 p-7 space-y-5">
        <div>
          <h1 className="font-display text-2xl text-ink">{school.name}</h1>
          <p className="text-sm text-ink-soft mt-1">Admission enquiry</p>
        </div>

        {!school.admissions_open ? (
          <p className="text-sm text-ink-soft">Admissions are closed at the moment — please check back soon.</p>
        ) : sent ? (
          <div className="rounded-xl bg-joy-leaf/15 border border-joy-leaf/40 px-4 py-4 text-sm text-ink">
            Thank you! We'll message you on WhatsApp shortly with next steps.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
            <label className="block text-sm">
              <span className="text-ink-soft">Your name</span>
              <input required value={form.parent_name} onChange={(e) => setForm({ ...form, parent_name: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
            </label>
            <label className="block text-sm">
              <span className="text-ink-soft">WhatsApp number</span>
              <input required inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="98765 43210" className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
            </label>
            <label className="block text-sm">
              <span className="text-ink-soft">Child's name</span>
              <input value={form.child_name} onChange={(e) => setForm({ ...form, child_name: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
            </label>
            <label className="block text-sm">
              <span className="text-ink-soft">Applying for</span>
              <select required value={form.applying_class} onChange={(e) => setForm({ ...form, applying_class: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep">
                <option value="">Select class…</option>
                {school.grades.map((g) => <option key={g.key} value={g.label}>{g.label}</option>)}
              </select>
            </label>
            {/* Honeypot — hidden from real visitors via CSS, bots that fill every field trip this */}
            <label className="hidden" aria-hidden="true">
              <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </label>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" required checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="w-4 h-4 mt-0.5 accent-terracotta" />
              <span>I agree to be contacted on WhatsApp about this enquiry.</span>
            </label>
            <button disabled={sending} className="w-full px-4 py-2.5 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
              {sending ? 'Sending…' : 'Send enquiry'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
