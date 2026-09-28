import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';
import StudentShell from './StudentShell';

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// The student's own borrowed books. /api/library/issues is scoped
// server-side to the logged-in student, so this never shows anyone else's.
export default function StudentLibrary() {
  const [issues, setIssues] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest('/api/library/issues')
      .then(setIssues)
      .catch((err) => { setError(err.message); setIssues([]); });
  }, []);

  const current = (issues || []).filter((i) => i.status === 'ISSUED');
  const past = (issues || []).filter((i) => i.status !== 'ISSUED');

  return (
    <StudentShell>
      <div className="space-y-5">
        <div>
          <h1 className="font-display text-3xl text-ink">My Library</h1>
          <p className="text-sm text-ink-soft mt-1">Books you have borrowed and when they are due back.</p>
        </div>

        {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

        {issues === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="font-display text-xl text-ink">With you now</h2>
              {current.length === 0 ? (
                <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 text-sm text-ink-soft">No books borrowed right now.</div>
              ) : (
                <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60">
                  {current.map((i) => (
                    <div key={i.id} className="p-4 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-ink">{i.book_title}</div>
                        <div className="text-xs text-ink-soft">Borrowed {fmt(i.issued_date)}</div>
                      </div>
                      <div className={`text-sm font-medium shrink-0 ${i.is_overdue ? 'text-destructive' : 'text-ink'}`}>
                        {i.is_overdue ? 'Overdue · ' : 'Due '}{fmt(i.due_date)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {past.length > 0 && (
              <section className="space-y-2">
                <h2 className="font-display text-xl text-ink">Returned</h2>
                <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60">
                  {past.map((i) => (
                    <div key={i.id} className="p-4 flex items-center justify-between gap-3">
                      <div className="text-ink">{i.book_title}</div>
                      <div className="text-xs text-ink-soft shrink-0">
                        Returned {fmt(i.returned_date)}{Number(i.fine_amount) > 0 ? ` · Fine ₹${Number(i.fine_amount)}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </StudentShell>
  );
}
