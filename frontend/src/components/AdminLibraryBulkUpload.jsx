import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { UploadCloud, Download, CheckCircle2, XCircle, FileSpreadsheet } from 'lucide-react';
import { apiRequest } from '../api';

// Bulk upload/update the library catalog, mirroring AdminBulkUpload.jsx's
// student pattern: CSV/Excel is parsed entirely client-side with xlsx
// (SheetJS), then the parsed rows are posted as JSON to
// POST /api/library/bulk-upsert, which validates and applies each row
// independently and returns a per-row result so failures never get silently
// dropped. See library.js's bulk-upsert route for the create-vs-update
// schema decision (isbn is the natural key when a row supplies one).
const TEMPLATE_HEADERS = ['title', 'author', 'isbn', 'category', 'total_copies'];

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ['The Alchemist', 'Paulo Coelho', '9780061122415', 'Fiction', '3'],
    ['NCERT Science - Class 8', '', '', 'Textbook', '10'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Books');
  XLSX.writeFile(wb, 'library-bulk-upload-template.xlsx');
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
          title: String(r.title || r.Title || '').trim(),
          author: String(r.author || r.Author || '').trim(),
          isbn: String(r.isbn || r.ISBN || '').trim(),
          category: String(r.category || r.Category || r.genre || r.Genre || '').trim(),
          total_copies: String(r.total_copies || r['Total Copies'] || r.copies || r.Copies || '').trim(),
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
  };
  const m = map[status] || { cls: 'bg-cream-deep text-ink-soft', label: status };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

export default function AdminLibraryBulkUpload() {
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
      setRows(parsed.filter((r) => r.title)); // skip fully blank trailing rows
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
      const res = await apiRequest('/api/library/bulk-upsert', { method: 'POST', body: { rows } });
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

  const failures = result?.results.filter((r) => r.status === 'error') || [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl text-ink">Bulk import books</h2>
          <p className="text-sm text-ink-soft mt-1">Upload a CSV or Excel file to add or update many catalog entries at once.</p>
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
          Columns: <code className="bg-cream-deep/50 px-1 rounded">title</code> (required),{' '}
          <code className="bg-cream-deep/50 px-1 rounded">author</code>,{' '}
          <code className="bg-cream-deep/50 px-1 rounded">isbn</code>,{' '}
          <code className="bg-cream-deep/50 px-1 rounded">category</code>, and{' '}
          <code className="bg-cream-deep/50 px-1 rounded">total_copies</code> (defaults to 1) — leave isbn blank to
          always add a new catalog entry, or fill it in to match an existing book: a match adds total_copies to its
          current stock instead of creating a duplicate entry.
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryTile label="Total rows" value={result.summary.total} />
            <SummaryTile label="Created" value={result.summary.created} tone="emerald" />
            <SummaryTile label="Updated" value={result.summary.updated} tone="terracotta" />
            <SummaryTile label="Failed" value={result.summary.failed} tone={result.summary.failed > 0 ? 'destructive' : undefined} />
          </div>

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
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Title</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cream-deep/60">
                    {failures.map((f) => (
                      <tr key={f.row_number}>
                        <td className="px-4 py-2 font-mono text-xs">{f.row_number}</td>
                        <td className="px-4 py-2">{f.input?.title || '—'}</td>
                        <td className="px-4 py-2 text-destructive">{f.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.results.some((r) => r.status !== 'error') && (
            <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
              <div className="px-4 py-3 border-b border-cream-deep/60 flex items-center gap-2 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="w-4 h-4" /> Applied successfully
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Row</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Title</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">ISBN</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Copies</th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-2 bg-cream-deep/40">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cream-deep/60">
                    {result.results.filter((r) => r.status !== 'error').map((r) => (
                      <tr key={r.row_number}>
                        <td className="px-4 py-2 font-mono text-xs">{r.row_number}</td>
                        <td className="px-4 py-2">{r.book?.title}</td>
                        <td className="px-4 py-2 font-mono text-xs">{r.book?.isbn || '—'}</td>
                        <td className="px-4 py-2">{r.book?.available_copies}/{r.book?.total_copies}</td>
                        <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
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
