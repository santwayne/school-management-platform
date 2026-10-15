import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { X, UploadCloud, Download, CheckCircle2, XCircle } from 'lucide-react';
import { apiRequest } from '../../api';

// Bulk staff import. The file (CSV or Excel) is parsed in the browser, checked
// on the server first (dry run) so the principal sees every problem before
// anything is created, then imported. Each person gets the role in their row.
const HEADERS = ['name', 'email', 'phone', 'role', 'password'];

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    HEADERS,
    ['Asha Rao', 'asha@school.edu.in', '9876543210', 'teacher', ''],
    ['Vikram Shah', 'vikram@school.edu.in', '9876500000', 'accountant', ''],
    ['Meena Iyer', 'meena@school.edu.in', '9876511111', 'librarian', ''],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Staff');
  XLSX.writeFile(wb, 'staff-import-template.xlsx');
}

// Accepts the header spellings real school files use ("Name*", "Mobile No.",
// "Email Address", "Designation"…): headers are compared with case, spaces and
// punctuation stripped.
const headerKey = (h) => String(h).replace(/^\ufeff/, '').toLowerCase().replace(/[^a-z]/g, '');
const HEADER_ALIASES = {
  name: ['name', 'staffname', 'fullname', 'teachername', 'employeename', 'nameofstaff', 'nameoftheemployee', 'nameofemployee'],
  email: ['email', 'emailid', 'emailaddress', 'mail', 'mailid', 'gmail'],
  phone: ['phone', 'mobile', 'phonenumber', 'mobilenumber', 'phoneno', 'mobileno', 'contact', 'contactno', 'contactnumber', 'whatsapp', 'whatsappnumber', 'whatsappno', 'cell', 'cellno'],
  role: ['role', 'designation', 'position', 'post', 'staffrole', 'stafftype'],
  password: ['password', 'pass', 'pwd'],
};
const pick = (r, field) => {
  const wanted = HEADER_ALIASES[field];
  for (const h of Object.keys(r)) {
    if (wanted.includes(headerKey(h)) && String(r[h]).trim() !== '') return String(r[h]).trim();
  }
  return '';
};
// Header row present at all? (Used to explain an empty parse.)
const hasHeader = (r, field) => Object.keys(r).some((h) => HEADER_ALIASES[field].includes(headerKey(h)));

function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = (evt) => {
      try {
        // CSV is read as plain text (raw) so a phone Excel saved as
        // "9.19877E+11" reaches the server as written and is flagged, instead
        // of being turned into a wrong number.
        const isCsv = /\.csv$/i.test(file.name);
        const wb = XLSX.read(evt.target.result, { type: 'array', raw: isCsv });
        const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        if (json.length) {
          const missing = ['name', 'email', 'phone'].filter((f) => !hasHeader(json[0], f));
          if (missing.length) {
            throw new Error(`The first row must be headers. Missing column(s): ${missing.join(', ')}. Found: ${Object.keys(json[0]).join(', ') || 'nothing'}. Download the template to see the format.`);
          }
        }
        resolve(
          json
            .map((r, i) => ({
              row_number: i + 2, // header is row 1
              name: pick(r, 'name'),
              email: pick(r, 'email'),
              phone: pick(r, 'phone'),
              role: pick(r, 'role'),
              password: pick(r, 'password'),
            }))
            .filter((r) => r.name || r.email || r.phone)
        );
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function downloadErrors(results) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['row,name,email,problem', ...results.filter((r) => r.status === 'error').map((r) => [r.row_number, r.name, r.email, r.error].map(q).join(','))];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'staff-import-problems.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCredentials(created) {
  const lines = ['name,email,role,temporary_password', ...created.filter((r) => r.temp_password).map((r) => [r.name, r.email, r.role, r.temp_password].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'new-staff-logins.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function StaffImportModal({ onClose, onDone }) {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setResult(null);
    setPreview(null);
    setFileName(file.name);
    try {
      const parsed = await parseFile(file);
      if (!parsed.length) throw new Error('No staff rows found — check the file has a header row (name, email, phone, role).');
      setRows(parsed);
      setBusy(true);
      setPreview(await apiRequest('/api/academics/teachers/bulk', { method: 'POST', body: { rows: parsed, dry_run: true } }));
    } catch (err) {
      setRows([]);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const importNow = async () => {
    // Only the rows that passed the check are sent.
    const okNumbers = new Set(preview.results.filter((r) => r.status === 'ok').map((r) => r.row_number));
    setBusy(true);
    setError('');
    try {
      const res = await apiRequest('/api/academics/teachers/bulk', { method: 'POST', body: { rows: rows.filter((r) => okNumbers.has(r.row_number)) } });
      setResult(res);
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const shown = result ? result.results : preview?.results || [];
  const created = result?.results.filter((r) => r.status === 'created') || [];

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">Import staff</h3>
          <button onClick={onClose} aria-label="Close"><X className="w-4 h-4 text-ink-soft" /></button>
        </div>

        <p className="text-sm text-ink-soft">
          Upload a CSV or Excel file with the columns <strong>name, email, phone, role</strong> (and optionally password). The role decides what each person can
          do: <strong>teacher, accountant, librarian</strong> or <strong>operator</strong> (blank means teacher). Anyone without a password gets a temporary one you can download.
        </p>

        {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm px-3 py-2">{error}</div>}

        {!result && (
          <div className="flex flex-wrap gap-2">
            <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cream-deep text-sm text-ink hover:bg-cream-deep/40">
              <Download className="w-4 h-4" /> Download template
            </button>
            <button onClick={() => inputRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
              <UploadCloud className="w-4 h-4" /> {fileName ? 'Choose another file' : 'Choose file'}
            </button>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
            {fileName && <span className="self-center text-xs text-ink-soft truncate">{fileName}</span>}
          </div>
        )}

        {busy && !result && <p className="text-sm text-ink-soft">Checking…</p>}

        {preview && !result && (
          <p className="text-sm text-ink">
            <strong>{preview.summary.valid}</strong> ready to import{preview.summary.failed > 0 && <>, <strong className="text-destructive">{preview.summary.failed}</strong> with problems (these will be skipped)</>}.
            {preview.summary.failed > 0 && (
              <button onClick={() => downloadErrors(preview.results)} className="ml-2 underline text-xs text-ink-soft hover:text-ink">Download problem list</button>
            )}
          </p>
        )}
        {preview && !result && preview.summary.valid === 0 && preview.summary.failed > 0 && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm px-3 py-2">
            No row can be imported yet. Fix the problem shown next to each row in your file, then choose the file again.
          </div>
        )}
        {result && (
          <div className="space-y-2">
            <p className="text-sm text-ink"><strong>{result.summary.created}</strong> staff created{result.summary.failed > 0 && <>, <strong className="text-destructive">{result.summary.failed}</strong> not created</>}.</p>
            {created.some((r) => r.temp_password) && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm px-3 py-2 flex items-center gap-2 flex-wrap">
                <span className="text-ink">Temporary passwords are shown only now. Download them and share each person's login.</span>
                <button onClick={() => downloadCredentials(created)} className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-terracotta text-primary-foreground text-xs font-medium">
                  <Download className="w-3.5 h-3.5" /> Download logins
                </button>
              </div>
            )}
          </div>
        )}

        {shown.length > 0 && (
          <div className="border border-cream-deep/70 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-cream-deep/60">
                {shown.map((r) => (
                  <tr key={r.row_number}>
                    <td className="px-3 py-2 w-10 text-xs text-ink-soft">#{r.row_number}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">{r.name || '—'}</div>
                      <div className="text-xs text-ink-soft">{r.email}{r.role ? ` · ${r.role}` : ''}</div>
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {r.status === 'error' ? (
                        <span className="inline-flex items-center gap-1 text-destructive"><XCircle className="w-3.5 h-3.5" /> {r.error}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> {r.status === 'created' ? 'Created' : 'Ready'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-ink-soft hover:bg-cream-deep/50">{result ? 'Close' : 'Cancel'}</button>
          {preview && !result && (
            <button onClick={importNow} disabled={busy || preview.summary.valid === 0} className="px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
              Import {preview.summary.valid} staff
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
