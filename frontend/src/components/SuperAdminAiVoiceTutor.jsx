import React, { useEffect, useState } from 'react';
import { Mic, PhoneCall, CheckCircle2, XCircle, Save } from 'lucide-react';
import { apiRequest } from '../api';

const LANGUAGES = [
  { key: 'assistant_id_english', label: 'English', callKey: 'en' },
  { key: 'assistant_id_hindi', label: 'Hindi', callKey: 'hi' },
  { key: 'assistant_id_punjabi', label: 'Punjabi', callKey: 'pa' },
];

export default function SuperAdminAiVoiceTutor() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({
    vapi_api_key: '', vapi_phone_number_id: '',
    assistant_id_english: '', assistant_id_hindi: '', assistant_id_punjabi: '',
    enabled: false,
  });
  const [schools, setSchools] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testLang, setTestLang] = useState('en');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = async () => {
    setError('');
    try {
      const cfg = await apiRequest('/api/super-admin/ai-voice-tutor');
      setConfig(cfg);
      setForm((f) => ({
        ...f,
        vapi_phone_number_id: cfg.vapi_phone_number_id || '',
        assistant_id_english: cfg.assistant_id_english || '',
        assistant_id_hindi: cfg.assistant_id_hindi || '',
        assistant_id_punjabi: cfg.assistant_id_punjabi || '',
        enabled: cfg.enabled || false,
      }));
      const s = await apiRequest('/api/super-admin/schools');
      setSchools(s);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/super-admin/ai-voice-tutor', { method: 'PUT', body: form });
      setForm((f) => ({ ...f, vapi_api_key: '' }));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const testCall = async () => {
    if (!testPhone) return setError('Enter a phone number to test.');
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const res = await apiRequest('/api/super-admin/ai-voice-tutor/test-call', {
        method: 'POST',
        body: { phone: testPhone, language: testLang },
      });
      setTestResult({ ok: true, callId: res.vapi_call_id });
    } catch (err) {
      setTestResult({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const toggleSchool = async (schoolId, enabled) => {
    setError('');
    try {
      await apiRequest(`/api/super-admin/ai-voice-tutor/schools/${schoolId}`, { method: 'PUT', body: { enabled } });
      setSchools((prev) => prev.map((s) => (s.id === schoolId ? { ...s, voice_tutor_enabled: enabled } : s)));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-3xl text-ink flex items-center gap-2">
          <Mic className="w-7 h-7 text-terracotta" /> AI Voice Tutor
        </h1>
        <p className="text-sm text-ink-soft mt-1">Connect the Vapi voice assistant once here, then switch it on per school.</p>
      </div>

      {error && <div className="rounded-xl bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div>}

      <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-display text-base text-ink">Vapi connection</div>
          <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${config?.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-cream-deep text-ink-soft'}`}>
            {config?.connected ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {config?.connected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        <label className="text-sm text-ink-soft space-y-1 block">
          Vapi API key
          <input
            type="password"
            value={form.vapi_api_key}
            onChange={(e) => setForm({ ...form, vapi_api_key: e.target.value })}
            placeholder={config?.vapi_api_key_masked || 'Paste your Vapi API key'}
            className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
          />
        </label>
        <label className="text-sm text-ink-soft space-y-1 block">
          Vapi phone number ID
          <input
            value={form.vapi_phone_number_id}
            onChange={(e) => setForm({ ...form, vapi_phone_number_id: e.target.value })}
            className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
          />
        </label>

        <div className="grid grid-cols-3 gap-3">
          {LANGUAGES.map((l) => (
            <label key={l.key} className="text-sm text-ink-soft space-y-1">
              {l.label} assistant ID
              <input
                value={form[l.key]}
                onChange={(e) => setForm({ ...form, [l.key]: e.target.value })}
                className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
              />
            </label>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Platform switch — turn on once you've tested it below
        </label>

        <button disabled={saving} onClick={save} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save connection'}
        </button>
      </div>

      <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 space-y-3">
        <div className="font-display text-base text-ink flex items-center gap-2">
          <PhoneCall className="w-4 h-4 text-terracotta" /> Test the connection
        </div>
        <p className="text-sm text-ink-soft">Places a real outbound call — save your connection details first.</p>
        <div className="flex gap-2 flex-wrap">
          <input
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="+9198XXXXXXXX"
            className="flex-1 min-w-[180px] rounded-lg border border-cream-deep/70 px-3 py-2 text-ink"
          />
          <select value={testLang} onChange={(e) => setTestLang(e.target.value)} className="rounded-lg border border-cream-deep/70 px-3 py-2 text-ink">
            {LANGUAGES.map((l) => <option key={l.callKey} value={l.callKey}>{l.label}</option>)}
          </select>
          <button disabled={testing} onClick={testCall} className="px-4 py-2 rounded-lg bg-white border border-cream-deep text-ink text-sm font-medium hover:bg-cream-deep/40 disabled:opacity-50">
            {testing ? 'Calling…' : 'Join voice / test call'}
          </button>
        </div>
        {testResult && (
          <div className={`text-sm rounded-lg px-3 py-2 ${testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            {testResult.ok ? `Call started — Vapi call ID ${testResult.callId}` : `Failed: ${testResult.message}`}
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
        <div className="p-4 font-display text-base text-ink">Enable per school</div>
        {schools.length === 0 ? (
          <div className="p-6 text-sm text-ink-soft text-center">No schools yet.</div>
        ) : schools.map((s) => (
          <div key={s.id} className="p-4 flex items-center justify-between">
            <div className="font-medium text-ink">{s.name}</div>
            <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
              <input
                type="checkbox"
                checked={!!s.voice_tutor_enabled}
                onChange={(e) => toggleSchool(s.id, e.target.checked)}
              />
              Voice Tutor enabled
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
