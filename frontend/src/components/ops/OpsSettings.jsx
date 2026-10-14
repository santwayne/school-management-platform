import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../api';
import { ErrorBanner, PageTitle } from './opsUi';

export default function OpsSettings() {
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest('/api/ops/settings')
      .then((s) => setForm({ ...s, operator_digest_phone: s.operator_digest_phone || '', principal_digest_phone: s.principal_digest_phone || '' }))
      .catch((e) => setError(e.message));
    apiRequest('/api/ops/digest/preview').then(setPreview).catch(() => {});
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await apiRequest('/api/ops/settings', { method: 'PUT', body: form });
      setSaved(true);
      setError('');
      apiRequest('/api/ops/digest/preview').then(setPreview).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!form) return error ? <ErrorBanner message={error} /> : <div className="text-sm text-ink-soft">Loading…</div>;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="space-y-6 max-w-2xl">
      <PageTitle title="Daily report" subtitle="Every morning at 8 AM, a one-line summary of yesterday goes on WhatsApp to the numbers below. It also appears in the dashboard notifications." />
      <ErrorBanner message={error} />

      <form onSubmit={save} className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-4">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.digest_enabled} onChange={set('digest_enabled')} className="w-4 h-4 accent-terracotta" />
          Send the daily report
        </label>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="text-ink-soft">Operator's WhatsApp number</span>
            <input value={form.operator_digest_phone} onChange={set('operator_digest_phone')} placeholder="98765 43210" inputMode="tel" className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
          </label>
          <label className="block text-sm">
            <span className="text-ink-soft">Principal's WhatsApp number</span>
            <input value={form.principal_digest_phone} onChange={set('principal_digest_phone')} placeholder="98765 43210" inputMode="tel" className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
          </label>
        </div>
        <label className="block text-sm max-w-xs">
          <span className="text-ink-soft">Language</span>
          <select value={form.digest_language} onChange={set('digest_language')} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep">
            <option value="hinglish">Hinglish</option>
            <option value="en">English</option>
          </select>
        </label>
        <div className="flex items-center gap-3">
          <button disabled={saving} className="px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-sm text-ink-soft">Saved.</span>}
        </div>
      </form>

      <AiAutomationSwitches />

      {preview && (
        <section className="space-y-2">
          <h2 className="font-display text-lg text-ink">Tomorrow's report would say</h2>
          <blockquote className="bg-white rounded-2xl border border-cream-deep/70 px-5 py-4 text-sm text-ink">{preview.line}</blockquote>
          <p className="text-xs text-ink-soft">The sent version may be worded a little differently by the AI, but uses exactly these numbers.</p>
        </section>
      )}
    </div>
  );
}

// AI automations that only reach staff (no parent ever gets these), so they
// are on by default. Parent notes have their own screen with consent.
function AiAutomationSwitches() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    apiRequest('/api/ai-automation/settings').then(setForm).catch((e) => setError(e.message));
  }, []);
  if (!form) return error ? <ErrorBanner message={error} /> : null;
  const toggle = (key) => async (e) => {
    const next = { ...form, [key]: e.target.checked };
    setForm(next);
    try {
      await apiRequest('/api/ai-automation/settings', { method: 'PUT', body: { [key]: e.target.checked } });
      setError('');
    } catch (err) {
      setError(err.message);
      setForm(form);
    }
  };
  return (
    <section className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-3 text-sm">
      <h2 className="font-display text-lg text-ink">AI helpers</h2>
      <ErrorBanner message={error} />
      <label className="flex items-start gap-2 text-ink">
        <input type="checkbox" checked={form.daily_plan_enabled} onChange={toggle('daily_plan_enabled')} className="w-4 h-4 mt-0.5 accent-terracotta" />
        <span>
          Today's plan at 7:30 AM (Mon–Sat)
          <span className="block text-xs text-ink-soft">The three things most worth doing today, on the Control Center and on WhatsApp to the numbers above (template <code>principal_daily_plan</code>).</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-ink">
        <input type="checkbox" checked={form.early_warning_enabled} onChange={toggle('early_warning_enabled')} className="w-4 h-4 mt-0.5 accent-terracotta" />
        <span>
          Weekly "needs attention" list (Sunday night)
          <span className="block text-xs text-ink-soft">Students whose attendance, marks, homework or tutor sessions point to a problem, with the evidence and a first step. Staff only.</span>
        </span>
      </label>
    </section>
  );
}
