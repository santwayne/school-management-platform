import React, { useCallback, useEffect, useState } from 'react';
import { Download, ShieldOff, CheckCircle2 } from 'lucide-react';
import { apiRequest, apiDownload } from '../api';

const TYPE_LABELS = {
  bonafide: 'Bonafide', character_certificate: 'Character', fee_certificate: 'Fee certificate', leaving_certificate: 'Transfer certificate',
};

function formatDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Issued certificates registry — Phase 4c's own serialed/verifiable
// records (issued_certificates), distinct from the older ad-hoc "Generate
// PDF" flow in AdminCertificates.jsx, which never touches this table.
export default function IssuedCertificates() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [processing, setProcessing] = useState(false);

  const load = useCallback(() => {
    apiRequest('/api/certificates').then(setItems).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const revoke = async (id) => {
    const reason = window.prompt('Reason for revoking (optional)?') || undefined;
    if (reason === undefined && !window.confirm('Revoke this certificate? It will no longer verify as valid.')) return;
    setBusyId(id);
    try {
      await apiRequest(`/api/certificates/${id}/revoke`, { method: 'POST', body: { reason } });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const processQueue = async () => {
    setProcessing(true);
    setError('');
    try {
      const r = await apiRequest('/api/certificates/process', { method: 'POST' });
      setNotice(`${r.processed} certificate${r.processed === 1 ? '' : 's'} auto-issued.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl text-ink">Issued certificates</h1>
          <p className="text-sm text-ink-soft mt-1 max-w-2xl">Every certificate with a real serial number and verify code — bonafide and character issue automatically, transfer certificates need your approval in the Inbox.</p>
        </div>
        <button disabled={processing} onClick={processQueue} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
          <CheckCircle2 className="w-4 h-4" /> {processing ? 'Checking…' : 'Process pending requests'}
        </button>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-xl bg-joy-leaf/15 border border-joy-leaf/40 px-4 py-2.5 text-sm text-ink">{notice}</div>}

      <div className="bg-white rounded-2xl border border-cream-deep/70 overflow-x-auto">
        {!items ? (
          <p className="px-5 py-8 text-sm text-ink-soft text-center">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-soft text-center">No certificates issued yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-soft">
              <tr className="border-b border-cream-deep/60">
                <th className="px-5 py-3 font-medium">Student</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Serial</th>
                <th className="px-5 py-3 font-medium">Issued</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-cream-deep/40 last:border-0">
                  <td className="px-5 py-3 text-ink font-medium">{c.student_name}</td>
                  <td className="px-5 py-3 text-ink-soft">{TYPE_LABELS[c.cert_type] || c.cert_type}{c.automatic && <span className="ml-1.5 text-[10px] text-terracotta-deep">auto</span>}</td>
                  <td className="px-5 py-3 text-ink-soft font-mono text-xs">{c.serial}</td>
                  <td className="px-5 py-3 text-ink-soft">{formatDate(c.issued_at)}</td>
                  <td className="px-5 py-3">
                    {c.revoked_at ? <span className="px-2 py-0.5 rounded-md text-xs bg-destructive/10 text-destructive">Revoked</span> : <span className="px-2 py-0.5 rounded-md text-xs bg-joy-leaf/15 text-ink">Valid</span>}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => apiDownload(`/api/certificates/${c.id}/pdf`, `${c.cert_type}-${c.serial}.pdf`).catch((err) => setError(err.message))}
                        className="text-ink-soft hover:text-terracotta-deep"
                        title="Download PDF"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      {!c.revoked_at && (
                        <button disabled={busyId === c.id} onClick={() => revoke(c.id)} className="text-ink-soft hover:text-destructive disabled:opacity-50" title="Revoke">
                          <ShieldOff className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
