import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { UploadCloud, Download, CheckCircle2, XCircle, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { apiRequest } from '../api';

// Bulk upload/update student data (feature 4.1). CSV/Excel is parsed
// entirely client-side with xlsx (SheetJS) — same library AdminReports.jsx
// already uses for exports — then the parsed rows are posted as JSON to
// POST /api/student-records/bulk-upsert, which validates and applies each
// row independently and returns a per-row result so failures never get
// silently dropped.
const TEMPLATE_HEADERS = ['name', 'class_name', 'grade', 'parent_name', 'parent_phone', 'login_id'];

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ['Aarav Sharma', '8A', '8', 'Rohit Sharma', '9876543210', ''],
    ['Diya Patel', '8A', '8', 'Nisha Patel', '9876500000', 'STD-1-AB12'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  XLSX.writeFile(wb, 'student-bulk-upload-template.xlsx');
}

function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        const rows = json.map((r, i) => ({
          row_number: i + 2, // header is row 1
          name: String(r.name || r.Name || '').trim(),
          class_name: String(r.class_name || r.Class || r.class || '').trim(),
          grade: String(r.grade || r.Grade || '').trim(),
          parent_name: String(r.parent_name || r['Parent Name'] || '').trim(),
          parent_phone: String(r.parent_phone || r['Parent Phone'] || '').trim(),
          login_id: String(r.login_id || r['Login ID'] || '').trim(),
        }));
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsArrayBuffer(file);
  });
}

function StatusBadge({ status }) {
  const map = {
    created: { cls: 'bg-emerald-500/10 text-emerald-700', label: 'Created' },
    updated: { cls: 'bg-terracotta/10 text-terracotta-deep', label: 'Updated' },
    error: { cls: 'bg-destructive/10 text-destructive', label: 'Error' },
    possible_duplicate: { cls: 'bg-amber-500/15 text-amber-700', label: 'Possible duplicate' },
  };
  const m = map[status] || { cls: 'bg-cream-deep text-ink-soft', label: status };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

export default function AdminBulkUpload() {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setResult(null);
    setFileName(file.name);
    setParsing(true);
    try {
      const parsed = await parseFile(file);
      setRows(parsed.filter((r) => r.name)); // skip fully blank trailing rows
    } catch (err) {
      setError('Could not parse that file — make sure it is a CSV or Excel file with a header row.');
      setRows([]);
    } finally {
      setParsing(false);
    }
  };

  const upload = async () => {
    if (rows.length === 0) return;
    setUploading(true);
    setError('');
    try {
      const res = await apiRequest('/api/student-records/bulk-upsert', { method: 'POST', body: { rows } });
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const retryFailedOnly = () => {
    if (!result) return;
    const failedRowNumbers = new Set(result.results.filter((r) => r.status === 'error').map((r) => r.row_number));
    setRows((prev) => prev.filter((r) => failedRowNumbers.has(r.row_number)));
    setResult(null);
  };

  // Item 8: a possible_duplicate row wasn't created — the admin confirms it's
  // really a new enrollment (twins, common names) by resubmitting just that
  // one row with confirm_duplicate: true, rather than re-uploading the whole
  // file.
  const createDuplicateAnyway = async (dup) => {
    setError('');
    try {
      const res = await apiRequest('/api/student-records/bulk-upsert', {
        method: 'POST',
        body: { rows: [{ ...dup.input, confirm_duplicate: true }] },
      });
      const updatedRow = res.results[0];
      setResult((prev) => ({
        ...prev,
        summary: {
          ...prev.summary,
          created: prev.summary.created + (updatedRow.status === 'created' ? 1 : 0),
          failed: prev.summary.failed + (updatedRow.status === 'error' ? 1 : 0),
          possible_duplicates: Math.max(0, (prev.summary.possible_duplicates || 0) - 1),
        },
        results: prev.results.map((r) => (r.row_number === dup.row_number ? updatedRow : r)),
      }));
    } catch (err) {
      setError(err.message);
    }
  };

  const failures = result?.results.filter((r) => r.status === 'error') || [];
  const duplicates = result?.results.filter((r) => r.status === 'possible_duplicate') || [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-ink">Bulk Upload Students</h1>
          <p className="text-sm text-ink-soft mt-1">Upload a CSV or Excel file to add or update many students at once.</p>
        </div>
        <button
          onClick={downloadTemplate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-deep bg-white text-xs font-medium text-ink hover:bg-cream-deep/40 transition shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          Download template
        </button>
      </div>

      <div className="rounded-2xl bg-white border border-cream-deep/70 p-6 space-y-3">
        <div className="text-xs text-ink-soft leading-relaxed">
          Columns: <code className="bg-cream-deep/50 px-1 rounded">name</code> (required),{' '}
          <code className="bg-cream-deep/50 px-1 rounded">class_name</code> (must match an existing class),{' '}
          <code className="bg-cream-deep/50 px-1 rounded">grade</code>,{' '}
          <code className="bg-cream-deep/50 px-1 rounded">parent_name</code>,{' '}
          <code className="bg-cream-deep/50 px-1 rounded">parent_phone</code>, and{' '}
          <code className="bg-cream-deep/50 px-1 rounded">login_id</code> — leave login_id blank to enroll a new
          student, or fill it in to update an existing one.
        </div>
        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-cream-deep rounded-2xl py-8 cursor-pointer hover:border-terracotta/40 transition">
          <UploadCloud className="w-8 h-8 text-ink-soft/60" />
          <span className="text-sm font-medium text-ink">{fileName || 'Click to choose a CSV or Excel file'}</span>
          <span className="text-xs text-ink-soft">.csv, .xlsx, .xls</span>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFile} />
        </label>

        {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
        {parsing && <p className="text-sm text-ink-soft">Parsing file…</p>}

        {rows.length > 0 && !result && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-ink">
              <FileSpreadsheet className="w-4 h-4 text-terracotta" />
              {rows.length} row{rows.length === 1 ? '' : 's'} parsed and ready to upload
            </div>
            <button
              onClick={upload}
              disabled={uploading}
              className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : `Upload ${rows.length} row${rows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </div>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <SummaryTile label="Total rows" value={result.summary.total} />
            <SummaryTile label="Created" value={result.summary.created} tone="emerald" />
            <SummaryTile label="Updated" value={result.summary.updated} tone="terracotta" />
            <SummaryTile label="Possible duplicates" value={result.summary.possible_duplicates || 0} tone={(result.summary.possible_duplicates || 0) > 0 ? 'amber' : undefined} />
            <SummaryTile label="Failed" value={result.summary.failed} tone={result.summary.failed > 0 ? 'destructive' : undefined} />
          </div>

          {duplicates.length > 0 && (
            <div className="rounded-2xl bg-white border border-amber-500/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-cream-deep/60 flex items-center gap-2 text-sm font-medium text-amber-700">
                <AlertTriangle className="w-4 h-4" /> {duplicates.length} row{duplicates.length === 1 ? '' : 's'} look like possible duplicates — not created yet
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Row</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Name</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Why</th>
                      <th className="px-4 py-2 bg-cream-deep/40" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cream-deep/60">
                    {duplicates.map((d) => (
                      <tr key={d.row_number}>
                        <td className="px-4 py-2 font-mono text-xs">{d.row_number}</td>
                        <td className="px-4 py-2">{d.input?.name || '—'}</td>
                        <td className="px-4 py-2 text-amber-700">{d.message}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => createDuplicateAnyway(d)}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-700 bg-amber-500/5 hover:bg-amber-500/15 transition whitespace-nowrap"
                          >
                            Create anyway
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {failures.length > 0 && (
            <div className="rounded-2xl bg-white border border-destructive/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-cream-deep/60 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <XCircle className="w-4 h-4" /> {failures.length} row{failures.length === 1 ? '' : 's'} need attention
                </div>
                <button
                  onClick={retryFailedOnly}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-cream-deep bg-white hover:bg-cream-deep/40 transition"
                >
                  Keep only failed rows to fix &amp; re-upload
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Row</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Name</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cream-deep/60">
                    {failures.map((f) => (
                      <tr key={f.row_number}>
                        <td className="px-4 py-2 font-mono text-xs">{f.row_number}</td>
                        <td className="px-4 py-2">{f.input?.name || '—'}</td>
                        <td className="px-4 py-2 text-destructive">{f.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.results.some((r) => r.status !== 'error' && r.status !== 'possible_duplicate') && (
            <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
              <div className="px-4 py-3 border-b border-cream-deep/60 flex items-center gap-2 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="w-4 h-4" /> Applied successfully
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Row</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Name</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Login ID</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">PIN</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Status</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cream-deep/60">
                    {result.results.filter((r) => r.status !== 'error' && r.status !== 'possible_duplicate').map((r) => (
                      <tr key={r.row_number}>
                        <td className="px-4 py-2 font-mono text-xs">{r.row_number}</td>
                        <td className="px-4 py-2">{r.student?.name}</td>
                        <td className="px-4 py-2 font-mono text-xs">{r.student?.login_id}</td>
                        {/* Only newly created rows have a fresh PIN — an updated
                            existing student's PIN is unchanged and unknown here
                            (S-1: recoverable later via the Students tab's Reset PIN action). */}
                        <td className="px-4 py-2 font-mono text-xs font-bold text-amber-900">{r.student?.defaultPin || '—'}</td>
                        <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                        <td className="px-4 py-2 text-xs text-amber-700">{r.warning || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button
            onClick={() => { setResult(null); setRows([]); setFileName(''); if (fileInputRef.current) fileInputRef.current.value = ''; }}
            className="text-sm text-terracotta-deep font-medium hover:text-terracotta"
          >
            Upload another file
          </button>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone }) {
  const toneCls = {
    emerald: 'text-emerald-700',
    terracotta: 'text-terracotta-deep',
    destructive: 'text-destructive',
    amber: 'text-amber-700',
  }[tone] || 'text-ink';
  return (
    <div className="rounded-2xl bg-white border border-cream-deep/70 p-4">
      <div className="text-xs uppercase tracking-wider text-ink-soft">{label}</div>
      <div className={`font-display text-2xl mt-1 ${toneCls}`}>{value}</div>
    </div>
  );
}
