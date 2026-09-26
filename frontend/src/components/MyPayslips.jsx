import React, { useEffect, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiRequest, apiDownload } from '../api';

const INR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function monthLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default function MyPayslips() {
  const [payslips, setPayslips] = useState(null);
  const [error, setError] = useState('');

  const download = (p) => {
    apiDownload(`/api/payroll-runs/payslips/${p.id}/pdf`, `payslip-${p.period}.pdf`).catch((err) => setError(err.message));
  };

  useEffect(() => {
    apiRequest('/api/payroll-runs/my-payslips')
      .then(setPayslips)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <header className="sticky top-0 z-10 bg-cream/85 backdrop-blur-md border-b border-cream-deep/70">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link to="/teacher" className="p-2 -ml-2 rounded-lg hover:bg-cream-deep/60 transition" aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-ink-soft" />
          </Link>
          <h1 className="font-display text-lg text-ink">My Payslips</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-3">
        {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm px-3 py-2">{error}</div>}

        {payslips === null && !error && (
          <div className="space-y-3">
            <div className="h-16 rounded-2xl bg-white/70 border border-cream-deep animate-pulse" />
            <div className="h-16 rounded-2xl bg-white/70 border border-cream-deep animate-pulse" />
          </div>
        )}

        {payslips && payslips.length === 0 && (
          <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 text-sm text-ink-soft text-center">
            No payslips yet — they'll appear here once the principal approves a month's payroll.
          </div>
        )}

        {payslips && payslips.map((p) => (
          <div key={p.id} className="rounded-2xl bg-white border border-cream-deep/70 p-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-display text-base text-ink">{monthLabel(p.period)}</div>
              <div className="text-xs text-ink-soft mt-0.5">
                Gross {INR(p.gross)} · Deductions {INR(p.deductions)}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="font-display text-lg text-ink">{INR(p.net_pay)}</div>
              <button
                onClick={() => download(p)}
                className="p-2 rounded-lg text-ink-soft hover:bg-cream-deep/60 hover:text-terracotta-deep transition"
                aria-label={`Download payslip for ${monthLabel(p.period)}`}
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
