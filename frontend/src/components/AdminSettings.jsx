import React, { useEffect, useRef, useState } from 'react';
import { apiRequest, apiUpload } from '../api';
import FeeCollectorsCard from './FeeCollectorsCard';

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between py-2.5 cursor-pointer">
      <span className="text-sm text-ink">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-6 rounded-full transition ${checked ? 'bg-terracotta' : 'bg-cream-deep'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </button>
    </label>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-2xl bg-white border border-cream-deep/70 p-6">
      <h2 className="font-display text-lg text-ink mb-4">{title}</h2>
      {children}
    </div>
  );
}

export default function AdminSettings() {
  const [settings, setSettings] = useState(null);
  const [schoolName, setSchoolName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoPreview, setLogoPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [limit, setLimit] = useState('5000');
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const s = await apiRequest('/api/settings');
      setSettings(s);
      setWhatsappNumber(s.whatsapp_business_number || '');
      setLimit(String(s.petty_cash_accountant_limit ?? 5000));
      setLogoUrl(s.logo_url || '');
      setLogoPreview(s.logo_url || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const flash = (msg) => {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(''), 2500);
  };

  const handleLogoFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPG, SVG, etc.).');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo must be under 2 MB.');
      return;
    }

    // Show local preview immediately while uploading
    const objectUrl = URL.createObjectURL(file);
    setLogoPreview(objectUrl);
    setError('');
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append('logo', file);
      const { logo_url } = await apiUpload('/api/settings/logo', fd);
      setLogoUrl(logo_url);
      setLogoPreview(logo_url);
      URL.revokeObjectURL(objectUrl);
      flash('Logo uploaded.');
    } catch (err) {
      setError('Upload failed: ' + err.message);
      setLogoPreview(logoUrl); // revert preview
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const saveBranding = async () => {
    setError('');
    try {
      const s = await apiRequest('/api/settings/branding', {
        method: 'PATCH',
        body: {
          school_name: schoolName || undefined,
          logo_url: logoUrl || undefined,
        },
      });
      setSettings(s);
      flash('Branding saved.');
    } catch (err) {
      setError(err.message);
    }
  };

  const saveWhatsapp = async () => {
    setError('');
    try {
      const res = await apiRequest('/api/settings/whatsapp', { method: 'PATCH', body: { whatsapp_business_number: whatsappNumber } });
      setAwaitingCode(true);
      flash(res.message || 'Verification code sent.');
    } catch (err) {
      setError(err.message);
    }
  };

  const verifyWhatsapp = async () => {
    setError('');
    if (!verifyCode) return setError('Enter the code sent to your WhatsApp.');
    try {
      const s = await apiRequest('/api/settings/whatsapp/verify', { method: 'POST', body: { code: verifyCode } });
      setSettings(s);
      setAwaitingCode(false);
      setVerifyCode('');
      flash('WhatsApp number verified and connected.');
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleNotif = async (key, value) => {
    setError('');
    try {
      const s = await apiRequest('/api/settings/notifications', { method: 'PATCH', body: { [key]: value } });
      setSettings(s);
    } catch (err) {
      setError(err.message);
    }
  };

  const saveLimit = async () => {
    setError('');
    const n = Number(limit);
    if (isNaN(n) || n < 0) return setError('Enter a valid limit amount.');
    try {
      const s = await apiRequest('/api/settings/petty-cash-limit', { method: 'PATCH', body: { limit: n } });
      setSettings(s);
      flash('Approval limit saved.');
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="p-6 max-w-2xl mx-auto"><p className="text-sm text-ink-soft">Loading…</p></div>;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="font-display text-3xl text-ink">Settings</h1>
        <p className="text-sm text-ink-soft mt-1">Branding, WhatsApp connection, notifications, and approval limits.</p>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {savedMsg && <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-700">{savedMsg}</div>}

      <Card title="Branding">
        {/* Logo */}
        <div className="mb-4">
          <span className="block text-xs font-medium text-ink-soft mb-2">School logo</span>
          <div className="flex items-center gap-4">
            {/* Preview box */}
            <div className="w-16 h-16 rounded-xl border border-cream-deep bg-cream-deep/40 flex items-center justify-center overflow-hidden flex-shrink-0">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo preview" className="w-full h-full object-contain" />
              ) : (
                <svg className="w-6 h-6 text-ink-soft/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoFile}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-3 py-1.5 rounded-lg border border-cream-deep bg-white text-xs font-medium text-ink hover:bg-cream-deep/40 transition disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : logoPreview ? 'Change logo' : 'Upload logo'}
              </button>
              <p className="text-xs text-ink-soft">PNG, JPG or SVG · max 2 MB</p>
            </div>
          </div>
        </div>

        {/* School name */}
        <label className="block mb-4">
          <span className="text-xs font-medium text-ink-soft">School name</span>
          <input
            type="text"
            placeholder="Type a new name to update it"
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm"
          />
        </label>

        <button
          onClick={saveBranding}
          disabled={uploading}
          className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition disabled:opacity-50"
        >
          Save branding
        </button>
      </Card>

      <Card title="WhatsApp Business">
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${settings.whatsapp_connected ? 'bg-emerald-500/10 text-emerald-700' : 'bg-cream-deep text-ink-soft'}`}>
            {settings.whatsapp_connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <label className="block mb-3">
          <span className="text-xs font-medium text-ink-soft">WhatsApp Business number</span>
          <input
            type="text"
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            placeholder="+91XXXXXXXXXX"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm"
          />
        </label>
        <p className="text-xs text-ink-soft mb-3">We send a 6-digit code to this number over WhatsApp — it only shows as connected once that code is confirmed.</p>
        <button onClick={saveWhatsapp} className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition">
          {awaitingCode ? 'Resend code' : 'Send verification code'}
        </button>
        {awaitingCode && (
          <div className="flex items-center gap-2 mt-3">
            <input
              type="text"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              placeholder="6-digit code"
              className="w-32 px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm"
            />
            <button onClick={verifyWhatsapp} className="px-4 py-2 rounded-lg bg-white border border-cream-deep text-ink text-sm font-medium hover:bg-cream-deep/40 transition">
              Verify
            </button>
          </div>
        )}
      </Card>

      <Card title="Notifications">
        <Toggle label="Attendance alerts to parents" checked={settings.notify_attendance} onChange={(v) => toggleNotif('notify_attendance', v)} />
        <Toggle label="Homework posted alerts" checked={settings.notify_homework} onChange={(v) => toggleNotif('notify_homework', v)} />
        <Toggle label="Fee reminders" checked={settings.notify_fees} onChange={(v) => toggleNotif('notify_fees', v)} />
        <Toggle label="Payroll processed alerts" checked={settings.notify_payroll} onChange={(v) => toggleNotif('notify_payroll', v)} />
      </Card>

      <Card title="Accountant approval limit">
        <p className="text-xs text-ink-soft mb-3">Petty cash requests at or under this amount can be approved by an Accountant. Above it, they route to you.</p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-soft">₹</span>
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-40 px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm"
          />
          <button onClick={saveLimit} className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition">
            Save
          </button>
        </div>
      </Card>

      <Card title="Fee Collectors">
        <FeeCollectorsCard />
      </Card>
    </div>
  );
}
