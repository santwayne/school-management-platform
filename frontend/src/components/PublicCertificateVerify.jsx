import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { apiRequest } from '../api';

// Public, no-auth verification page — the QR code / short link printed on
// every issued certificate resolves here, so anyone (another school, an
// employer) can confirm a certificate is genuine and not revoked.
export default function PublicCertificateVerify() {
  const { code } = useParams();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest(`/api/public/certificates/verify/${code}`)
      .then(setResult)
      .catch((err) => setError(err.message));
  }, [code]);

  return (
    <div className="min-h-screen bg-cream font-sans flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-cream-deep/70 p-7 text-center space-y-4">
        {!result && !error && <p className="text-sm text-ink-soft">Checking…</p>}

        {error && (
          <>
            <ShieldX className="w-10 h-10 text-destructive mx-auto" />
            <h1 className="font-display text-xl text-ink">Not valid</h1>
            <p className="text-sm text-ink-soft">{error}</p>
          </>
        )}

        {result && !result.valid && (
          <>
            <ShieldX className="w-10 h-10 text-destructive mx-auto" />
            <h1 className="font-display text-xl text-ink">Not valid</h1>
            <p className="text-sm text-ink-soft">{result.error || 'This code does not match any certificate.'}</p>
          </>
        )}

        {result?.valid && (
          <>
            {result.revoked ? (
              <>
                <ShieldX className="w-10 h-10 text-destructive mx-auto" />
                <h1 className="font-display text-xl text-ink">Revoked</h1>
                <p className="text-sm text-ink-soft">This certificate has been revoked by the school and is no longer valid.</p>
              </>
            ) : (
              <>
                <ShieldCheck className="w-10 h-10 text-joy-leaf mx-auto" />
                <h1 className="font-display text-xl text-ink">Genuine certificate</h1>
              </>
            )}
            <dl className="text-left text-sm bg-cream rounded-xl p-4 space-y-2 mt-2">
              <div className="flex justify-between"><dt className="text-ink-soft">Certificate</dt><dd className="text-ink font-medium">{result.title}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Serial</dt><dd className="text-ink font-mono text-xs">{result.serial}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Student</dt><dd className="text-ink">{result.student_name}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Class</dt><dd className="text-ink">{result.class}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">School</dt><dd className="text-ink">{result.school}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Issued on</dt><dd className="text-ink">{result.issued_on}</dd></div>
            </dl>
          </>
        )}
      </div>
    </div>
  );
}
