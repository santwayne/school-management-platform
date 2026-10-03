import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';

// Super Admin only: add / replace / remove one school's WhatsApp Business
// number and its Meta keys. The keys are checked with Meta before saving,
// the access token is write-only (never shown again after saving), and the
// school's principal is emailed once the number is connected.
export default function SuperAdminWhatsApp({ school, onClose, onChanged }) {
  const [conn, setConn] = useState(null);
  const [form, setForm] = useState({ whatsapp_number: '', phone_number_id: '', waba_id: '', access_token: '' });
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testTo, setTestTo] = useState('');

  const apply = (c) => {
    setConn(c);
    setForm({ whatsapp_number: c.whatsapp_number || '', phone_number_id: c.phone_number_id || '', waba_id: c.waba_id || '', access_token: '' });
  };

  useEffect(() => {
    apiRequest(`/api/super-admin/schools/${school.id}/whatsapp`, { method: 'GET' })
      .then(apply)
      .catch((err) => setError(err.message));
  }, [school.id]);

  const run = async (name, fn) => {
    setBusy(name);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const emailNote = (email) =>
    email?.sent ? `Principal emailed at ${email.to.join(', ')}.` : `Principal was NOT emailed: ${email?.reason || 'unknown reason'}`;

  const save = (e) => {
    e.preventDefault();
    run('save', async () => {
      const body = { ...form, notify };
      if (!body.access_token) delete body.access_token; // keep the saved token
      const out = await apiRequest(`/api/super-admin/schools/${school.id}/whatsapp`, { method: 'PUT', body });
      apply({ ...out.connection, email_configured: conn?.email_configured });
      setNotice(`Connected and verified with Meta. ${emailNote(out.email)}`);
      onChanged?.();
    });
  };

  const resend = () =>
    run('notify', async () => {
      const out = await apiRequest(`/api/super-admin/schools/${school.id}/whatsapp/notify`, { method: 'POST' });
      setNotice(emailNote(out.email));
    });

  const sendTest = () =>
    run('test', async () => {
      await apiRequest(`/api/super-admin/schools/${school.id}/whatsapp/test`, { method: 'POST', body: { to: testTo } });
      setNotice(`Test message (hello_world) sent to ${testTo} from the school's number.`);
    });

  const disconnect = () => {
    if (!window.confirm(`Disconnect WhatsApp for "${school.name}"? The saved keys are deleted and the school stops sending WhatsApp messages until a number is connected again.`)) return;
    run('disconnect', async () => {
      const out = await apiRequest(`/api/super-admin/schools/${school.id}/whatsapp`, { method: 'DELETE' });
      apply({ ...out.connection, email_configured: conn?.email_configured });
      setNotice('WhatsApp disconnected for this school.');
      onChanged?.();
    });
  };

  const field = (key, label, props = {}) => (
    <label className="block">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        autoComplete="off"
        className="mt-1 w-full p-2 border rounded text-sm"
        {...props}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg my-8 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">WhatsApp — {school.name}</h2>
            <p className="text-xs text-ink-soft mt-1">The school's own WhatsApp Business number and Meta keys. Only Super Admins can see or change this.</p>
          </div>
          <button onClick={onClose} className="text-ink-soft font-bold text-xl leading-none" aria-label="Close">×</button>
        </div>

        {error && <div className="p-3 bg-red-100 text-destructive rounded text-sm">{error}</div>}
        {notice && <div className="p-3 bg-emerald-50 text-emerald-800 rounded text-sm">{notice}</div>}

        {!conn ? (
          !error && <p className="text-sm text-ink-soft">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`px-2 py-1 rounded-full font-medium ${conn.connected ? 'bg-green-100 text-green-800' : 'bg-cream-deep text-ink-soft'}`}>
                {conn.connected ? `Connected · ${conn.whatsapp_number}` : 'Not connected'}
              </span>
              {conn.connected && conn.verified_name && <span className="text-ink-soft">Shown as “{conn.verified_name}”</span>}
              {conn.connected && (
                <span className="text-ink-soft">
                  {conn.emailed_at ? `Principal emailed ${new Date(conn.emailed_at).toLocaleDateString('en-IN')}` : 'Principal not emailed yet'}
                </span>
              )}
            </div>

            <form onSubmit={save} className="space-y-3" autoComplete="off">
              {field('whatsapp_number', 'WhatsApp Business number (with country code)', { placeholder: '+91 98765 43210', required: true })}
              {field('phone_number_id', 'Phone Number ID (Meta → WhatsApp → API Setup)', { placeholder: 'e.g. 123456789012345', required: true, inputMode: 'numeric' })}
              {field('waba_id', 'WhatsApp Business Account ID (optional)', { placeholder: 'e.g. 109876543210987', inputMode: 'numeric' })}
              {field('access_token', conn.has_token ? `Access token — saved (${conn.token_hint}). Leave blank to keep it.` : 'Permanent access token (System User token)', {
                type: 'password',
                name: 'wa-access-token-new',
                autoComplete: 'new-password',
                placeholder: conn.has_token ? 'Paste a new token only to replace it' : 'EAAG…',
                required: !conn.has_token,
              })}
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-1" />
                <span>
                  Email the principal that the number is connected
                  <span className="block text-xs text-ink-soft">
                    {conn.principal_emails?.length ? `Goes to ${conn.principal_emails.join(', ')}. Sent on a first connection or when the number changes.` : 'No principal email on file for this school.'}
                    {conn.email_configured === false && ' Email (SMTP) is not configured on the server yet — nothing will be sent.'}
                  </span>
                </span>
              </label>
              <button type="submit" disabled={busy !== ''} className="w-full py-2 bg-terracotta text-white rounded font-medium hover:bg-terracotta-deep disabled:opacity-50">
                {busy === 'save' ? 'Checking with Meta…' : conn.connected ? 'Verify & save changes' : 'Verify & connect'}
              </button>
              <p className="text-xs text-ink-soft">The keys are checked with Meta before saving. The token is stored encrypted and is never shown again.</p>
            </form>

            {conn.connected && (
              <div className="border-t pt-4 space-y-3">
                <div className="flex gap-2">
                  <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send a test to +91…" className="flex-1 p-2 border rounded text-sm" />
                  <button onClick={sendTest} disabled={busy !== '' || !testTo} className="px-3 py-2 rounded bg-blue-100 text-blue-800 text-sm font-medium disabled:opacity-50">
                    {busy === 'test' ? 'Sending…' : 'Send test'}
                  </button>
                </div>
                <div className="flex justify-between gap-2">
                  <button onClick={resend} disabled={busy !== ''} className="px-3 py-2 rounded bg-cream-deep text-ink text-sm font-medium disabled:opacity-50">
                    {busy === 'notify' ? 'Sending…' : 'Re-send email to principal'}
                  </button>
                  <button onClick={disconnect} disabled={busy !== ''} className="px-3 py-2 rounded bg-red-100 text-red-800 text-sm font-medium disabled:opacity-50">
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
