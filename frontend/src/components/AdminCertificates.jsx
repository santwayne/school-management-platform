import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Award, Settings as SettingsIcon } from 'lucide-react';
import { apiRequest } from '../api';
import { downloadLeavingCertificate } from '../lib/leavingCertificate';

// Generate a School Leaving Certificate PDF for any student on request
// (feature 4.3). The PDF is built client-side with jsPDF, following
// AdminReports.jsx's buildPDF pattern, using the shared
// lib/leavingCertificate.js template so the same layout is reused by the
// document-request queue (4.4/4.5) and the student's own download.
export default function AdminCertificates() {
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [settings, setSettings] = useState(null);

  const loadStudents = async (q = '') => {
    setLoading(true);
    try {
      setStudents(await apiRequest(`/api/academics/students${q ? `?search=${encodeURIComponent(q)}` : ''}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    apiRequest('/api/settings').then(setSettings).catch((err) => setError(err.message));
    loadStudents();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadStudents(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const generate = async (studentId) => {
    setBusyId(studentId);
    setError('');
    try {
      const data = await apiRequest(`/api/student-records/students/${studentId}/certificate-data`);
      downloadLeavingCertificate(data, { ...settings, school_name: settings.school_name });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-ink flex items-center gap-2">
            <Award className="w-7 h-7 text-terracotta" /> Leaving Certificates
          </h1>
          <p className="text-sm text-ink-soft mt-1">Search a student and generate their School Leaving Certificate as a PDF.</p>
        </div>
        <Link
          to="/admin/settings"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-deep bg-white text-xs font-medium text-ink hover:bg-cream-deep/40 transition shrink-0"
        >
          <SettingsIcon className="w-3.5 h-3.5" />
          Edit letterhead &amp; signatory
        </Link>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students…"
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
        />
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Name</th>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Class</th>
                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Login ID</th>
                <th className="px-4 py-3 bg-cream-deep/40" />
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-deep/60">
              {loading ? (
                <tr><td className="px-4 py-4 text-ink-soft" colSpan={4}>Loading…</td></tr>
              ) : students.length === 0 ? (
                <tr><td className="px-4 py-4 text-ink-soft" colSpan={4}>No students found.</td></tr>
              ) : (
                students.map((s) => (
                  <tr key={s.id} className="hover:bg-cream-deep/20">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-ink-soft">{s.class_name || '—'}</td>
                    <td className="px-4 py-3 text-ink-soft font-mono text-xs">{s.login_id || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        disabled={busyId === s.id || !settings}
                        onClick={() => generate(s.id)}
                        className="px-3 py-1.5 rounded-lg bg-terracotta text-primary-foreground text-xs font-medium hover:bg-terracotta-deep transition disabled:opacity-50"
                      >
                        {busyId === s.id ? 'Generating…' : 'Generate PDF'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
