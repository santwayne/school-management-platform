import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';

export default function SyllabusManager() {
  const [syllabusList, setSyllabusList] = useState([]);
  const [manualForm, setManualForm] = useState({ class_id: '', subject_id: '', chapter_id: '', chapter_name: '', target_start_date: '', target_end_date: '' });
  const [errors, setErrors] = useState(null);
  const [message, setMessage] = useState('');

  const loadSyllabus = async () => {
    try {
      const data = await apiRequest('/api/syllabus', { method: 'GET' });
      setSyllabusList(data);
    } catch (err) { setErrors('Failed to load tracking calendar entries.'); }
  };

  useEffect(() => { loadSyllabus(); }, []);

  const downloadTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8,class_id,subject_id,chapter_id,chapter_name,target_start_date,target_end_date\n1,MATH101,CH1,Real Numbers,2026-06-01,2026-06-15\n1,MATH101,CH2,Polynomials,2026-06-16,2026-06-30";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "syllabus_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target.result;
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const headers = lines[0].split(",").map(h => h.trim());
      
      const parsedRows = lines.slice(1).map(line => {
        const values = line.split(",");
        return {
          class_id: parseInt(values[headers.indexOf('class_id')]),
          subject_id: values[headers.indexOf('subject_id')],
          chapter_id: values[headers.indexOf('chapter_id')],
          chapter_name: values[headers.indexOf('chapter_name')],
          target_start_date: values[headers.indexOf('target_start_date')],
          target_end_date: values[headers.indexOf('target_end_date')]
        };
      });

      try {
        setErrors(null);
        const res = await apiRequest('/api/syllabus/upload', {
          method: 'POST',
          body: { rows: parsedRows }
        });
        setMessage(`Uploaded! Success: ${res.inserted_count} rows inserted.`);
        if (res.failed_count > 0) setErrors({ batchDetails: res.details });
        loadSyllabus();
      } catch (err) { setErrors({ message: err.message || 'File parsing batch failure.' }); }
    };
    reader.readAsText(file);
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    try {
      setErrors(null);
      await apiRequest('/api/syllabus/upload', {
        method: 'POST',
        body: { rows: [manualForm] }
      });
      setMessage('Single tracking sequence added.');
      setManualForm({ class_id: '', subject_id: '', chapter_id: '', chapter_name: '', target_start_date: '', target_end_date: '' });
      loadSyllabus();
    } catch (err) { setErrors({ message: err.message }); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this syllabus record?")) return;
    try {
      await apiRequest(`/api/syllabus/${id}`, { method: 'DELETE' });
      loadSyllabus();
    } catch (err) { alert(err.message); }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="font-display text-2xl font-bold text-ink">Academic Syllabus Planner</h1>
        <button onClick={downloadTemplate} className="px-4 py-2 bg-cream-deep/40 hover:bg-cream-deep/60 text-ink-soft text-sm font-medium rounded border">
          Download CSV Template
        </button>
      </div>

      {message && <div className="p-3 bg-green-100 text-green-700 rounded text-sm">{message}</div>}
      {errors && (
        <div className="p-3 bg-red-100 text-destructive rounded text-sm space-y-1">
          {errors.message && <div>{errors.message}</div>}
          {errors.batchDetails && errors.batchDetails.map((f, i) => (
            <div key={i} className="text-xs font-mono">• Line index {f.index}: {f.error} ({f.row.chapter_name || 'unknown'})</div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Column */}
        <div className="space-y-6">
          <div className="bg-white p-4 border rounded-lg shadow-sm space-y-3">
            <h3 className="font-semibold text-ink">Bulk Stream Input</h3>
            <input type="file" accept=".csv" onChange={handleFileUpload} className="block w-full text-xs text-ink-soft file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-terracotta/5 file:text-terracotta-deep hover:file:bg-terracotta/10" />
          </div>

          <form onSubmit={handleManualSubmit} className="bg-white p-4 border rounded-lg shadow-sm space-y-3">
            <h3 className="font-semibold text-ink">Add Entry Form</h3>
            <input type="number" placeholder="Class ID" value={manualForm.class_id} onChange={e => setManualForm({...manualForm, class_id: e.target.value})} required className="w-full p-2 border text-sm rounded" />
            <input type="text" placeholder="Subject ID (e.g. MATH101)" value={manualForm.subject_id} onChange={e => setManualForm({...manualForm, subject_id: e.target.value})} required className="w-full p-2 border text-sm rounded" />
            <input type="text" placeholder="Chapter ID (e.g. CH1)" value={manualForm.chapter_id} onChange={e => setManualForm({...manualForm, chapter_id: e.target.value})} required className="w-full p-2 border text-sm rounded" />
            <input type="text" placeholder="Chapter Structural Name" value={manualForm.chapter_name} onChange={e => setManualForm({...manualForm, chapter_name: e.target.value})} required className="w-full p-2 border text-sm rounded" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-ink-soft">Target Start</label>
                <input type="date" value={manualForm.target_start_date} onChange={e => setManualForm({...manualForm, target_start_date: e.target.value})} required className="w-full p-1 border text-sm rounded" />
              </div>
              <div>
                <label className="text-xs text-ink-soft">Target End</label>
                <input type="date" value={manualForm.target_end_date} onChange={e => setManualForm({...manualForm, target_end_date: e.target.value})} required className="w-full p-1 border text-sm rounded" />
              </div>
            </div>
            <button type="submit" className="w-full py-2 bg-terracotta hover:bg-terracotta-deep text-white rounded text-sm font-medium">Save Row Entry</button>
          </form>
        </div>

        {/* Display List Panel Table */}
        <div className="lg:col-span-2 bg-white border rounded-lg shadow-sm overflow-hidden">
          <table className="w-full border-collapse text-left text-sm text-ink-soft">
            <thead className="bg-cream text-xs font-semibold text-ink-soft uppercase">
              <tr>
                <th className="p-3">Scope Context</th>
                <th className="p-3">Chapter</th>
                <th className="p-3">Timeline Constraints</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-deep/60">
              {syllabusList.map(item => (
                <tr key={item.id} className="hover:bg-cream">
                  <td className="p-3 font-medium text-ink">
                    Cls {item.class_id} <span className="text-ink-soft font-normal">| {item.subject_id}</span>
                  </td>
                  <td className="p-3">
                    <span className="font-mono text-xs bg-cream-deep/40 px-1 py-0.5 rounded mr-1">{item.chapter_id}</span>
                    {item.chapter_name}
                  </td>
                  <td className="p-3 text-xs">
                    {new Date(item.target_start_date).toLocaleDateString()} - {new Date(item.target_end_date).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDelete(item.id)} className="text-xs px-2 py-1 text-destructive hover:bg-destructive/10 rounded">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}