import React, { useEffect, useState } from 'react';
import { FileText, Send, Download, Clock } from 'lucide-react';
import { apiRequest } from '../api';
import StudentShell from './StudentShell';
import { downloadLeavingCertificate } from '../lib/leavingCertificate';

// Student/parent-facing "Request a certificate" page (feature 4.4), plus
// download once a request is APPROVED/READY (feature 4.5). Follows
// StudentHome.jsx's conventions — wrapped in StudentShell, no separate
// admin-style layout.
const TYPES = [
  { value: 'leaving_certificate', label: 'School Leaving Certificate' },
  { value: 'bonafide', label: 'Bonafide Certificate' },
  { value: 'id_card', label: 'ID Card' },
];
const CERT_TYPES = new Set(['leaving_certificate', 'bonafide']);

function StatusBadge({ status }) {
  const cls = {
    PENDING: 'bg-amber-500/15 text-amber-700',
    APPROVED: 'bg-terracotta/12 text-terracotta-deep',
    READY: 'bg-emerald-500/10 text-emerald-700',
    REJECTED: 'bg-destructive/10 text-destructive',
  }[status] || 'bg-cream-deep text-ink-soft';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
}

export default function StudentCertificateRequest() {
  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(null);
  const [requests, setRequests] = useState(null);
  const [type, setType] = useState(TYPES[0].value);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState(null);

  const loadRequests = async () => {
    try {
      setRequests(await apiRequest('/api/student/document-requests'));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    apiRequest('/api/student/me').then(setProfile).catch((err) => setError(err.message));
    apiRequest('/api/settings').then(setSettings).catch(() => {});
    loadRequests();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      await apiRequest('/api/student/document-requests', { method: 'POST', body: { request_type: type } });
      setMessage('Request submitted — you\'ll see it below once the school reviews it.');
      loadRequests();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const download = () => {
    setBusyId('download');
    try {
      downloadLeavingCertificate(profile, settings || {});
    } finally {
      setBusyId(null);
    }
  };

  return (
    <StudentShell>
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-3xl text-ink flex items-center gap-2">
            <FileText className="w-7 h-7 text-terracotta" /> Request a certificate
          </h1>
          <p className="text-sm text-ink-soft mt-1">Ask the school office for a certificate or ID card, and track its status here.</p>
        </div>

        {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
        {message && <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-700">{message}</div>}

        <form onSubmit={submit} className="rounded-2xl bg-white border border-cream-deep/70 p-5 flex items-end gap-3 flex-wrap">
          <label className="text-sm flex-1 min-w-[220px]">
            <span className="block text-xs font-medium text-ink-soft mb-1">Certificate / document type</span>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm">
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition disabled:opacity-50"
          >
            <Send className="w-4 h-4" /> {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </form>

        <div>
          <h2 className="font-display text-xl mb-3">Your requests</h2>
          {requests === null ? (
            <p className="text-sm text-ink-soft">Loading…</p>
          ) : requests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-cream-deep bg-white/60 p-6 text-center text-sm text-ink-soft">
              No requests yet — submit one above.
            </div>
          ) : (
            <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
              {requests.map((r) => {
                const canDownload = CERT_TYPES.has(r.request_type) && ['APPROVED', 'READY'].includes(r.status) && profile;
                return (
                  <div key={r.id} className="p-4 flex items-center gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-ink capitalize">{r.request_type.replace(/_/g, ' ')}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="text-xs text-ink-soft mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Requested {new Date(r.requested_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                      {r.review_note && <div className="text-xs text-ink-soft mt-1">Note from school: {r.review_note}</div>}
                    </div>
                    {canDownload && (
                      <button
                        disabled={busyId === 'download'}
                        onClick={download}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-cream-deep text-ink text-sm font-medium hover:bg-cream-deep/40 transition disabled:opacity-50 shrink-0"
                      >
                        <Download className="w-4 h-4" /> Download PDF
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </StudentShell>
  );
}
