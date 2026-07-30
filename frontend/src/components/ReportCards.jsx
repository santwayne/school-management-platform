import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FileDown, FileText, Send, CheckCircle2 } from 'lucide-react';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// Best-effort: fetch the school logo and inline it as a data URL so jsPDF
// can render it. If the host doesn't send CORS headers (common for plain S3
// buckets) this silently falls back to a text-only header — the report card
// still generates either way.
async function loadLogoDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function buildReportCardPDF(data) {
  const doc = new jsPDF();
  const { school, exam, student, marks, total_obtained, total_max, percentage } = data;

  let cursorY = 18;
  const logoDataUrl = await loadLogoDataUrl(school.logo_url);
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', 14, 10, 18, 18);
    } catch {
      // Unsupported image format — ignore, header text still renders.
    }
  }
  const textX = logoDataUrl ? 36 : 14;

  doc.setFontSize(16);
  doc.text(school.school_name || 'School Report Card', textX, cursorY);
  cursorY += 7;
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text('Report Card', textX, cursorY);

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

export default function ReportCards() {
  const { user } = useAuth();
  const isPrincipal = user?.role === 'principal';

  const [classes, setClasses] = useState([]);
  const [myClasses, setMyClasses] = useState([]);
  const [exams, setExams] = useState([]);
  const [classId, setClassId] = useState('');
  const [examId, setExamId] = useState('');
  const [students, setStudents] = useState([]);
  const [generatingId, setGeneratingId] = useState(null);
  const [publishing, setPublishing] = useState(false);

  const [loading, setLoading] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [error, setError] = useState('');

  const availableClasses = useMemo(() => {
    if (isPrincipal) return classes;
    const ids = new Set(myClasses.map((c) => c.class_id));
    return classes.filter((c) => ids.has(c.id));
  }, [classes, myClasses, isPrincipal]);

  const examsForClass = useMemo(() => exams.filter((e) => String(e.class_id) === String(classId)), [exams, classId]);
  const selectedExam = useMemo(() => exams.find((e) => String(e.id) === String(examId)), [exams, examId]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [c, ex] = await Promise.all([
          apiRequest('/api/academics/classes'),
          apiRequest('/api/exams'),
        ]);
        setClasses(c);
        setExams(ex);
        if (!isPrincipal) {
          const mine = await apiRequest('/api/academics/my-classes');
          setMyClasses(mine);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isPrincipal]);

  useEffect(() => {
    setExamId('');
    setStudents([]);
  }, [classId]);

  useEffect(() => {
    async function loadRoster() {
      if (!classId || !examId) {
        setStudents([]);
        return;
      }
      setRosterLoading(true);
      setError('');
      try {
        const data = await apiRequest(`/api/academics/class/${classId}/roster`);
        setStudents(data.students);
      } catch (err) {
        setError(err.message);
      } finally {
        setRosterLoading(false);
      }
    }
    loadRoster();
  }, [classId, examId]);

  const publishResult = async () => {
    if (!examId || !window.confirm('Publish this result? Every student and their parent will be notified once — this can only be done once per exam.')) return;
    setPublishing(true);
    setError('');
    try {
      await apiRequest(`/api/exams/${examId}/publish-result`, { method: 'POST' });
      const ex = await apiRequest('/api/exams');
      setExams(ex);
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  const generate = async (studentId) => {
    setGeneratingId(studentId);
    setError('');
    try {
      const data = await apiRequest(`/api/exams/${examId}/students/${studentId}/report`);
      if (data.marks.length === 0) {
        setError('No marks entered yet for this student in this exam.');
        return;
      }
      await buildReportCardPDF(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingId(null);
    }
  };

  if (loading) return <p className="text-sm text-ink-soft">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-ink">Report Cards</h1>
        <p className="text-sm text-ink-soft mt-1">Auto-compiled PDF report cards, pulled from marks already entered.</p>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Class">
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
            >
              <option value="">Select class</option>
              {availableClasses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Exam">
            <select
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
              disabled={!classId}
              className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
            >
              <option value="">Select exam</option>
              {examsForClass.map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.term ? ` · ${e.term}` : ''}</option>
              ))}
            </select>
          </Field>
        </div>

        {isPrincipal && examId && (
          <div className="mt-4 pt-4 border-t border-cream-deep/60 flex items-center gap-3">
            {selectedExam?.result_published_at ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4" /> Result published on {new Date(selectedExam.result_published_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            ) : (
              <button
                onClick={publishResult}
                disabled={publishing}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition disabled:opacity-50"
              >
                <Send className="w-4 h-4" /> {publishing ? 'Publishing…' : 'Publish result to parents & students'}
              </button>
            )}
          </div>
        )}
      </div>

      {rosterLoading && <p className="text-sm text-ink-soft">Loading students…</p>}

      {!rosterLoading && classId && examId && (
        <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
          {students.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center text-ink-soft">
              <FileText className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">No students in this class yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Student</th>
                  <th className="text-right font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40">Report card</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-deep/60">
                {students.map((s, i) => (
                  <tr key={s.id} className="hover:bg-cream-deep/20">
                    <td className="px-4 py-3 align-middle">
                      <span className="text-ink-soft/60 text-xs mr-2">{i + 1}.</span>
                      {s.name}
                    </td>
                    <td className="px-4 py-3 align-middle text-right">
                      <button
                        onClick={() => generate(s.id)}
                        disabled={generatingId === s.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-deep bg-white text-xs font-medium text-ink hover:bg-cream-deep/40 transition disabled:opacity-50"
                      >
                        <FileDown className="w-3.5 h-3.5 text-terracotta" />
                        {generatingId === s.id ? 'Generating…' : 'Download PDF'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
