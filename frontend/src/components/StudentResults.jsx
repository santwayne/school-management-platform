import React, { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FileDown, GraduationCap } from 'lucide-react';
import { apiRequest } from '../api';
import StudentShell from './StudentShell';

// Same layout as ReportCards.jsx's buildReportCardPDF (admin/teacher side) —
// kept as a separate copy rather than a shared import since the two
// components live in different portals with different auth guards, but the
// PDF itself should look identical regardless of who generated it.
async function buildReportCardPDF(data) {
  const doc = new jsPDF();
  const { school, exam, student, marks, total_obtained, total_max, percentage } = data;

  let cursorY = 18;
  doc.setFontSize(16);
  doc.text(school.school_name || 'School Report Card', 14, cursorY);
  cursorY += 7;
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text('Report Card', 14, cursorY);

  cursorY = 34;
  doc.setDrawColor(220);
  doc.line(14, cursorY, 196, cursorY);
  cursorY += 8;

  doc.setFontSize(11);
  doc.setTextColor(30);
  doc.text(`Student: ${student.name}`, 14, cursorY);
  doc.text(`Class: ${exam.class_name}`, 120, cursorY);
  cursorY += 7;
  doc.text(`Exam: ${exam.name}${exam.term ? ' · ' + exam.term : ''}`, 14, cursorY);
  if (student.login_id) doc.text(`Roll/Login ID: ${student.login_id}`, 120, cursorY);
  cursorY += 8;

  autoTable(doc, {
    startY: cursorY,
    head: [['Subject', 'Marks Obtained', 'Max Marks']],
    body: marks.map((m) => [m.subject_name, m.marks_obtained, m.max_marks]),
    styles: { fontSize: 10 },
    foot: [['Total', total_obtained, total_max]],
    footStyles: { fontStyle: 'bold', fillColor: [245, 240, 232], textColor: 30 },
  });

  const afterTableY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(13);
  doc.setTextColor(30);
  doc.text(`Percentage: ${percentage !== null ? percentage + '%' : 'N/A'}`, 14, afterTableY);

  doc.save(`${student.name.replace(/\s+/g, '_')}_${exam.name.replace(/\s+/g, '_')}_report_card.pdf`);
}

export default function StudentResults() {
  const [exams, setExams] = useState(null);
  const [error, setError] = useState('');
  const [reports, setReports] = useState({}); // examId -> report data
  const [openId, setOpenId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    apiRequest('/api/student/exams')
      .then(setExams)
      .catch((err) => setError(err.message));
  }, []);

  const toggle = async (examId) => {
    if (openId === examId) {
      setOpenId(null);
      return;
    }
    setOpenId(examId);
    if (!reports[examId]) {
      try {
        const data = await apiRequest(`/api/student/exams/${examId}/report`);
        setReports((prev) => ({ ...prev, [examId]: data }));
      } catch (err) {
        setError(err.message);
      }
    }
  };

  const download = async (examId) => {
    setDownloadingId(examId);
    setError('');
    try {
      const data = reports[examId] || (await apiRequest(`/api/student/exams/${examId}/report`));
      await buildReportCardPDF(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <StudentShell>
      <div className="space-y-5">
        <div>
          <h1 className="font-display text-3xl text-ink">Results</h1>
          <p className="text-sm text-ink-soft mt-1">Published exam results, straight from your teachers' marks entry.</p>
        </div>

        {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

        {exams === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : exams.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center text-ink-soft rounded-2xl bg-white border border-cream-deep/70">
            <GraduationCap className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No results published yet.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {exams.map((e) => {
              const report = reports[e.id];
              const open = openId === e.id;
              return (
                <div key={e.id} className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
                  <button
                    onClick={() => toggle(e.id)}
                    className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-cream-deep/20 text-left"
                  >
                    <div>
                      <div className="font-medium text-ink">{e.name}{e.term ? ` · ${e.term}` : ''}</div>
                      <div className="text-xs text-ink-soft mt-0.5">
                        Published {new Date(e.result_published_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                    {report && report.percentage !== null && (
                      <span className="text-sm font-semibold text-terracotta-deep">{report.percentage}%</span>
                    )}
                  </button>

                  {open && (
                    <div className="px-4 pb-4 border-t border-cream-deep/60 pt-3">
                      {!report ? (
                        <p className="text-sm text-ink-soft">Loading…</p>
                      ) : (
                        <>
                          <table className="w-full text-sm mb-3">
                            <thead>
                              <tr>
                                <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-2 py-2">Subject</th>
                                <th className="text-right font-medium text-xs uppercase tracking-wider text-ink-soft px-2 py-2">Marks</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-cream-deep/50">
                              {report.marks.map((m) => (
                                <tr key={m.subject_name}>
                                  <td className="px-2 py-2">{m.subject_name}</td>
                                  <td className="px-2 py-2 text-right">{m.marks_obtained} / {m.max_marks}</td>
                                </tr>
                              ))}
                              <tr className="font-semibold">
                                <td className="px-2 py-2">Total</td>
                                <td className="px-2 py-2 text-right">{report.total_obtained} / {report.total_max}</td>
                              </tr>
                            </tbody>
                          </table>
                          <button
                            onClick={() => download(e.id)}
                            disabled={downloadingId === e.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-deep bg-white text-xs font-medium text-ink hover:bg-cream-deep/40 transition disabled:opacity-50"
                          >
                            <FileDown className="w-3.5 h-3.5 text-terracotta" />
                            {downloadingId === e.id ? 'Generating…' : 'Download PDF'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </StudentShell>
  );
}
