import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Clock, PackageCheck, Download } from 'lucide-react';
import { apiRequest } from '../api';
import { downloadLeavingCertificate } from '../lib/leavingCertificate';

const TABS = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'READY', label: 'Ready' },
  { key: 'REJECTED', label: 'Rejected' },
];

// certificate-shaped types get an on-demand PDF regenerated from the shared
// leavingCertificate.js template; other types (e.g. id_card) have no PDF —
// approving them just marks status READY, per feature 4.7.
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

// Generic admin approval queue for the document_requests table, shared by
// certificate requests (4.4) and ID-card requests (4.7) — the source spec
// explicitly asks for this sharing rather than two near-duplicate
// components, so this one is parameterized entirely by `requestTypes`.
export default function DocumentRequestQueue({ requestTypes, emptyLabel = 'Nothing here right now.' }) {
  const [tab, setTab] = useState('PENDING');
  const [requests, setRequests] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = async (status) => {
    setError('');
    try {
      const qs = new URLSearchParams({ request_type: requestTypes.join(','), status });
      setRequests(await apiRequest(`/api/student-records/document-requests?${qs}`));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    apiRequest('/api/settings').then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    setRequests(null);
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, requestTypes.join(',')]);

  const review = async (id, status) => {
    setBusyId(id);
    setError('');
    try {
      await apiRequest(`/api/student-records/document-requests/${id}`, { method: 'PATCH', body: { status } });
      await load(tab);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const download = async (r) => {
    setBusyId(r.id);
    setError('');
    try {
      const data = await apiRequest(`/api/student-records/students/${r.student_id}/certificate-data`);
      downloadLeavingCertificate(data, settings || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="border-b border-cream-deep/70 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t.key ? 'border-terracotta text-terracotta-deep' : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      {requests === null ? (
        <div className="text-sm text-ink-soft py-8 text-center">Loading…</div>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-8 text-center text-sm text-ink-soft">{emptyLabel}</div>
      ) : (
        <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
          {requests.map((r) => {
            const isCert = CERT_TYPES.has(r.request_type);
            const canDownload = isCert && ['APPROVED', 'READY'].includes(r.status);
            return (
              <div key={r.id} className="p-4 flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-ink">{r.student_name}</span>
                    <span className="text-xs text-ink-soft">{r.class_name || 'No class'}</span>
                    <span className="text-ink-soft/50 text-xs">·</span>
                    <span className="text-xs font-medium text-terracotta-deep capitalize">{r.request_type.replace(/_/g, ' ')}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-xs text-ink-soft mt-1">
                    Requested {new Date(r.requested_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {r.parent_name && <> · Parent: {r.parent_name}</>}
                  </div>
                  {r.review_note && <div className="text-xs text-ink-soft mt-2">Note: {r.review_note}</div>}
                </div>
                <div className="flex gap-2 shrink-0 items-center">
                  {r.status === 'PENDING' && (
                    <>
                      <button
                        disabled={busyId === r.id}
                        onClick={() => review(r.id, 'APPROVED')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Approve
                      </button>
                      <button
                        disabled={busyId === r.id}
                        onClick={() => review(r.id, 'REJECTED')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-cream-deep text-ink text-sm font-medium hover:bg-cream-deep/40 disabled:opacity-50"
                      >
                        <XCircle className="w-4 h-4" /> Reject
                      </button>
                    </>
                  )}
                  {r.status === 'APPROVED' && (
                    <button
                      disabled={busyId === r.id}
                      onClick={() => review(r.id, 'READY')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50"
                    >
                      <PackageCheck className="w-4 h-4" /> Mark ready
                    </button>
                  )}
                  {canDownload && (
                    <button
                      disabled={busyId === r.id}
                      onClick={() => download(r)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-cream-deep text-ink text-sm font-medium hover:bg-cream-deep/40 disabled:opacity-50"
                    >
                      <Download className="w-4 h-4" /> Download PDF
                    </button>
                  )}
                  {['REJECTED', 'READY'].includes(r.status) && !canDownload && (
                    <div className="flex items-center gap-1 text-xs text-ink-soft">
                      <Clock className="w-3.5 h-3.5" />
                      {r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString('en-IN') : ''}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
