import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';

// Super Admin only: add / replace / remove one school's OWN Razorpay
// account. School fee money (fee payment links, fee reminders, admission
// application fees) is collected with these keys, so it settles to the
// school's bank account. Waynur's platform Razorpay account is only used
// for Waynur's own plan billing. The keys are checked with Razorpay before
// saving, and both secrets are write-only (never shown again).
export default function SuperAdminRazorpay({ school, onClose, onChanged }) {
  const [conn, setConn] = useState(null);
  const [form, setForm] = useState({ key_id: '', key_secret: '', webhook_secret: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  const apply = (c) => {
    setConn(c);
    setForm({ key_id: c.key_id || '', key_secret: '', webhook_secret: '' });
  };

  useEffect(() => {
    apiRequest(`/api/super-admin/schools/${school.id}/razorpay`, { method: 'GET' })
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

  const save = (e) => {
    e.preventDefault();
    run('save', async () => {
      const body = { key_id: form.key_id.trim() };
      if (form.key_secret) body.key_secret = form.key_secret; // blank keeps the saved one
      if (form.webhook_secret) body.webhook_secret = form.webhook_secret;
      const out = await apiRequest(`/api/super-admin/schools/${school.id}/razorpay`, { method: 'PUT', body });
      apply(out.connection);
      setNotice('Keys checked with Razorpay and saved. Now add the webhook below in the school\'s Razorpay dashboard, if it is not there yet.');
      onChanged?.();
    });
  };

  const disconnect = () => {
    if (!window.confirm(`Disconnect Razorpay for "${school.name}"? The saved keys are deleted. The school can no longer send fee payment links, and payments on links already sent will not be recorded automatically.`)) return;
    run('disconnect', async () => {
      const out = await apiRequest(`/api/super-admin/schools/${school.id}/razorpay`, { method: 'DELETE' });
      apply(out.connection);
      setNotice('Razorpay disconnected for this school.');
      onChanged?.();
    });
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(conn.webhook_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the URL and copy it by hand.');
    }
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

  // The saved secret only stays valid for the same Key ID.
  const sameKey = Boolean(conn?.connected) && form.key_id.trim() === conn.key_id;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg my-8 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">Razorpay — {school.name}</h2>
            <p className="text-xs text-ink-soft mt-1">
              The school's own Razorpay account. Fee payments from parents go straight to the school's bank account — never to Waynur's. Only Super Admins can see or change this.
            </p>
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
                {conn.connected ? `Connected · ${conn.mode === 'live' ? 'Live' : 'Test mode'}` : 'Not connected'}
              </span>
              {conn.connected && conn.mode === 'test' && <span className="text-amber-700 font-medium">Test keys — no real money moves.</span>}
              {conn.connected && (
                <span className="text-ink-soft">
                  {conn.last_webhook_at ? `Last payment event received ${new Date(conn.last_webhook_at).toLocaleString('en-IN')}` : 'No payment event received from Razorpay yet'}
                </span>
              )}
            </div>

            {!conn.connected && (
              <p className="text-sm text-ink-soft bg-cream rounded p-3">
                Until keys are added, this school cannot send online fee payment links and gets no automatic fee reminders. Cash and manual fee entries work as usual.
              </p>
            )}

            <form onSubmit={save} className="space-y-3" autoComplete="off">
              {field('key_id', 'Key ID (school\'s Razorpay → Account & Settings → API Keys)', { placeholder: 'rzp_live_…', required: true })}
              {field('key_secret', sameKey ? `Key Secret — saved (${conn.secret_hint}). Leave blank to keep it.` : 'Key Secret', {
                type: 'password',
                name: 'rz-key-secret-new',
                autoComplete: 'new-password',
                placeholder: sameKey ? 'Paste a new secret only to replace it' : 'Shown once when the key is generated',
                required: !sameKey,
              })}
              {field('webhook_secret', conn.connected ? `Webhook secret — saved (${conn.webhook_hint}). Leave blank to keep it.` : 'Webhook secret (any strong text you choose — you will type the same text in Razorpay)', {
                type: 'password',
                name: 'rz-webhook-secret-new',
                autoComplete: 'new-password',
                placeholder: conn.connected ? 'Type a new one only to replace it' : 'At least 8 characters',
                required: !conn.connected,
              })}
              <button type="submit" disabled={busy !== ''} className="w-full py-2 bg-terracotta text-white rounded font-medium hover:bg-terracotta-deep disabled:opacity-50">
                {busy === 'save' ? 'Checking with Razorpay…' : conn.connected ? 'Verify & save changes' : 'Verify & connect'}
              </button>
              <p className="text-xs text-ink-soft">The keys are checked with Razorpay before saving. Both secrets are stored encrypted and are never shown again.</p>
            </form>

            <div className="border-t pt-4 space-y-2">
              <h3 className="text-sm font-semibold text-ink">Webhook to add in the school's Razorpay dashboard</h3>
              <p className="text-xs text-ink-soft">
                Without it a payment still reaches the school's bank, but Waynur is not told — the fee stays "due" and no confirmation goes to the parent.
              </p>
              <ol className="text-xs text-ink-soft list-decimal pl-4 space-y-1">
                <li>In the school's Razorpay dashboard, switch to <strong>{conn.mode === 'test' ? 'Test' : 'Live'} mode</strong> → Account &amp; Settings → Webhooks → Add New Webhook.</li>
                <li>Webhook URL (this school only):</li>
              </ol>
              <div className="flex gap-2">
                <input readOnly value={conn.webhook_url} onFocus={(e) => e.target.select()} className="flex-1 p-2 border rounded text-xs font-mono bg-cream" />
                <button type="button" onClick={copyUrl} className="px-3 py-2 rounded bg-cream-deep text-ink text-xs font-medium">{copied ? 'Copied' : 'Copy'}</button>
              </div>
              <ol start={3} className="text-xs text-ink-soft list-decimal pl-4 space-y-1">
                <li>Secret: the same webhook secret typed above.</li>
                <li>Active events: <strong>{(conn.webhook_events || []).join(', ')}</strong></li>
              </ol>
            </div>

            {conn.connected && (
              <div className="border-t pt-4 flex justify-end">
                <button onClick={disconnect} disabled={busy !== ''} className="px-3 py-2 rounded bg-red-100 text-red-800 text-sm font-medium disabled:opacity-50">
                  Disconnect
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
