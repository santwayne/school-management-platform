import React, { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../api';
import { PageTitle, ErrorBanner, Notice } from './admissionsUi';

const TOPICS = [
  ['timings', 'School timings'],
  ['board', 'Board / curriculum'],
  ['facilities', 'Facilities'],
  ['transport_areas', 'Transport areas covered'],
  ['admission_process', 'Admission process'],
  ['documents_required', 'Documents required'],
  ['address', 'Address / directions'],
  ['custom', 'Other'],
];

function KnowledgeBaseTab() {
  const [answers, setAnswers] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    apiRequest('/api/admissions/knowledge-base')
      .then((d) => {
        const map = Object.fromEntries(TOPICS.map(([t]) => [t, { answer: '', audience: 'all' }]));
        for (const it of d.items) map[it.topic] = { answer: it.answer, audience: it.audience };
        setAnswers(map);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const items = TOPICS.map(([topic]) => ({ topic, answer: answers[topic].answer, audience: answers[topic].audience }));
      await apiRequest('/api/admissions/knowledge-base', { method: 'PUT', body: { items } });
      setNotice('Saved. The bot will use these answers immediately.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!answers) return error ? <ErrorBanner message={error} /> : <div className="text-sm text-ink-soft">Loading…</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft max-w-2xl">
        The admissions bot only answers FAQs from what's written here — it never invents facts. Leave a topic blank and the bot will say "our office will share that."
      </p>
      <ErrorBanner message={error} />
      <Notice message={notice} />
      <div className="bg-white rounded-2xl border border-cream-deep/70 divide-y divide-cream-deep/50">
        {TOPICS.map(([topic, label]) => (
          <div key={topic} className="p-5 space-y-2">
            <label className="text-sm font-medium text-ink">{label}</label>
            <textarea
              rows={2}
              value={answers[topic].answer}
              onChange={(e) => setAnswers({ ...answers, [topic]: { ...answers[topic], answer: e.target.value } })}
              placeholder="Not set"
              className="w-full px-3 py-2 rounded-lg border border-cream-deep text-sm"
            />
          </div>
        ))}
      </div>
      <button disabled={saving} onClick={save} className="px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
        {saving ? 'Saving…' : 'Save answers'}
      </button>
    </div>
  );
}

function SettingsTab() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    apiRequest('/api/admissions/settings').then(setForm).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/admissions/settings', {
        method: 'PUT',
        body: { admission_code: form.admission_code, public_slug: form.public_slug, admissions_open: form.admissions_open, admission_followup_days: form.admission_followup_days },
      });
      setNotice('Saved.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!form) return error ? <ErrorBanner message={error} /> : <div className="text-sm text-ink-soft">Loading…</div>;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const enquiryUrl = form.public_slug ? `${window.location.origin}/admissions/${form.public_slug}` : null;

  return (
    <form onSubmit={save} className="space-y-4 max-w-xl">
      <ErrorBanner message={error} />
      <Notice message={notice} />
      <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-4">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.admissions_open} onChange={set('admissions_open')} className="w-4 h-4 accent-terracotta" />
          Admissions are currently open
        </label>
        <label className="block text-sm">
          <span className="text-ink-soft">Admission code (parents mention this on WhatsApp)</span>
          <input value={form.admission_code || ''} onChange={set('admission_code')} placeholder="e.g. GVS2026" className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
        </label>
        <label className="block text-sm">
          <span className="text-ink-soft">Website address (used in the enquiry link)</span>
          <input value={form.public_slug || ''} onChange={set('public_slug')} placeholder="green-valley-school" className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
        </label>
        <label className="block text-sm max-w-xs">
          <span className="text-ink-soft">Follow up on days (comma-separated)</span>
          <input value={form.admission_followup_days || ''} onChange={set('admission_followup_days')} placeholder="1,3,7" className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
        </label>
        <button disabled={saving} className="px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {enquiryUrl && (
        <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-2">
          <h2 className="font-display text-lg text-ink">Public enquiry page</h2>
          <p className="text-sm text-ink-soft">Share or embed this link on your school's website:</p>
          <a href={enquiryUrl} target="_blank" rel="noreferrer" className="text-sm text-terracotta-deep hover:underline break-all">{enquiryUrl}</a>
        </div>
      )}
      {form.whatsapp_link && (
        <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-2">
          <h2 className="font-display text-lg text-ink">Direct WhatsApp link</h2>
          <p className="text-sm text-ink-soft">Pre-fills the admission code so the bot knows which school straight away:</p>
          <a href={form.whatsapp_link} target="_blank" rel="noreferrer" className="text-sm text-terracotta-deep hover:underline break-all">{form.whatsapp_link}</a>
        </div>
      )}
    </form>
  );
}

export default function AdmissionSettings() {
  const [tab, setTab] = useState('kb');
  return (
    <div className="space-y-5">
      <PageTitle title="Admission settings" subtitle="What the bot knows, and how families reach it." />
      <div className="flex gap-1 border-b border-cream-deep/70">
        {[['kb', 'Knowledge base'], ['settings', 'Settings']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm ${tab === k ? 'border-b-2 border-terracotta text-terracotta-deep font-medium' : 'text-ink-soft hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'kb' ? <KnowledgeBaseTab /> : <SettingsTab />}
    </div>
  );
}
