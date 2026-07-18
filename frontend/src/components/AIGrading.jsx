import React, { useEffect, useState } from 'react';
import { GraduationCap, Plus, X, Upload, CheckCircle2, AlertTriangle, ClipboardCheck } from 'lucide-react';
import { apiRequest } from '../api';

const CONFIDENCE_STYLE = {
  high: 'bg-emerald-500/10 text-emerald-700',
  medium: 'bg-amber-500/15 text-amber-700',
  low: 'bg-terracotta/15 text-terracotta-deep',
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function GenerateTestModal({ classes, onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', subject_id: '', chapter_id: '', difficulty: 'medium', class_id: '', question_count: 5 });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.subject_id || !form.chapter_id) return setError('Subject and chapter/topic are required.');
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/premium-ai/test/generate', {
        method: 'POST',
        body: { ...form, question_count: Number(form.question_count) || 5, class_id: form.class_id || null },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-display text-base text-ink">Generate a test</div>
          <button onClick={onClose}><X className="w-4 h-4 text-ink-soft" /></button>
        </div>
        {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs px-3 py-2">{error}</div>}
        <input placeholder="Title (optional)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Subject" value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
          <input placeholder="Chapter / topic" value={form.chapter_id} onChange={(e) => setForm({ ...form, chapter_id: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink">
            {['easy', 'medium', 'hard'].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink">
            <option value="">Any class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <label className="text-sm text-ink-soft space-y-1 block">
          Number of questions
          <input type="number" min={1} max={20} value={form.question_count} onChange={(e) => setForm({ ...form, question_count: e.target.value })} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink" />
        </label>
        <p className="text-xs text-ink-soft">Claude generates the questions and a model answer key together — the test is gradeable right away.</p>
        <button disabled={saving} onClick={save} className="w-full px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
          {saving ? 'Generating…' : 'Generate test'}
        </button>
      </div>
    </div>
  );
}

function SubmitAnswerPanel({ test, onClose, onSubmitted }) {
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [questionNum, setQuestionNum] = useState(test.rubric?.[0]?.question_num || 1);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest('/api/academics/students').then(setStudents).catch(() => {});
  }, []);

  const pickFile = (f) => {
    setFile(f);
    setResult(null);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const submit = async () => {
    if (!studentId || !file) return setError('Pick a student and upload a photo of their answer.');
    setSubmitting(true);
    setError('');
    try {
      const base64 = await fileToBase64(file);
      const data = await apiRequest('/api/grading/submit', {
        method: 'POST',
        body: {
          student_id: studentId,
          test_id: test.id,
          question_num: Number(questionNum),
          image_base64: base64,
          media_type: file.type || 'image/jpeg',
        },
      });
      setResult(data.evaluation);
      onSubmitted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-lg space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-display text-base text-ink">Grade an answer — {test.title}</div>
          <button onClick={onClose}><X className="w-4 h-4 text-ink-soft" /></button>
        </div>
        {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs px-3 py-2">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-ink-soft space-y-1">
            Student
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink">
              <option value="">— select —</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-ink-soft space-y-1">
            Question
            <select value={questionNum} onChange={(e) => setQuestionNum(e.target.value)} className="w-full rounded-lg border border-cream-deep/70 px-3 py-2 text-ink">
              {(test.rubric || []).map((r) => <option key={r.question_num} value={r.question_num}>Q{r.question_num} ({r.max_marks} marks)</option>)}
            </select>
          </label>
        </div>

        <label className="block">
          <div className="text-sm text-ink-soft mb-1">Answer sheet photo</div>
          <div className="border-2 border-dashed border-cream-deep/70 rounded-xl p-4 text-center cursor-pointer hover:bg-cream-deep/20">
            <input type="file" accept="image/*" className="hidden" id="answer-photo" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
            <label htmlFor="answer-photo" className="cursor-pointer flex flex-col items-center gap-2 text-ink-soft">
              <Upload className="w-5 h-5" />
              <span className="text-sm">{file ? file.name : 'Click to upload a photo'}</span>
            </label>
          </div>
          {preview && <img src={preview} alt="Answer preview" className="mt-2 rounded-lg max-h-48 mx-auto" />}
        </label>

        <button disabled={submitting} onClick={submit} className="w-full px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
          {submitting ? 'Grading…' : 'Submit for AI grading'}
        </button>

        {result && (
          <div className="rounded-xl border border-cream-deep/70 p-4 space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl text-terracotta-deep">{result.score}</span>
              <span className="text-ink-soft">/ {result.maxMarks} marks</span>
              <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${CONFIDENCE_STYLE[result.confidence] || CONFIDENCE_STYLE.low}`}>
                {result.confidence} confidence
              </span>
            </div>
            <div className="text-xs text-ink-soft italic">"{result.extractedText}"</div>
            <div className="text-sm text-ink bg-cream-deep/30 rounded-lg px-3 py-2">{result.justification}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function PendingReviewQueue() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [overrides, setOverrides] = useState({});

  const load = async () => {
    setError('');
    try {
      setRows(await apiRequest('/api/grading/pending'));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, []);

  const confirm = async (id) => {
    setError('');
    try {
      const override = overrides[id];
      await apiRequest(`/api/grading/${id}/confirm`, {
        method: 'PATCH',
        body: { final_score: override !== undefined && override !== '' ? Number(override) : undefined },
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="font-display text-lg text-ink flex items-center gap-2">
        <ClipboardCheck className="w-5 h-5 text-terracotta" /> Pending teacher review
      </div>
      <p className="text-sm text-ink-soft -mt-2">Nothing counts as a final grade until confirmed here.</p>
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
      {rows === null ? (
        <div className="text-sm text-ink-soft py-6 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-6 text-center text-sm text-ink-soft">Nothing waiting on review.</div>
      ) : (
        <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
          {rows.map((r) => (
            <div key={r.id} className="p-4 flex flex-col md:flex-row gap-3 md:items-center">
              {r.answer_image_base64 && (
                <img src={`data:image/jpeg;base64,${r.answer_image_base64}`} alt="Answer" className="w-20 h-20 object-cover rounded-lg border border-cream-deep shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-ink">{r.student_name}</span>
                  <span className="text-xs text-ink-soft">{r.test_title} · Q{r.question_num}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CONFIDENCE_STYLE[r.ocr_confidence] || CONFIDENCE_STYLE.low}`}>
                    {r.ocr_confidence || 'low'} confidence
                  </span>
                </div>
                <p className="text-xs text-ink-soft mt-1 italic">"{r.extracted_text}"</p>
                <p className="text-xs text-terracotta-deep mt-1">{r.justification}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <div className="text-xs text-ink-soft">AI score</div>
                  <div className="text-lg font-bold text-terracotta-deep">{r.ai_score}/{r.max_marks}</div>
                </div>
                <input
                  type="number"
                  placeholder="Override"
                  value={overrides[r.id] ?? ''}
                  onChange={(e) => setOverrides({ ...overrides, [r.id]: e.target.value })}
                  className="w-20 p-2 border border-cream-deep/70 rounded-lg text-sm"
                />
                <button onClick={() => confirm(r.id)} className="px-3 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep">
                  Confirm
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AIGrading() {
  const [tests, setTests] = useState(null);
  const [classes, setClasses] = useState([]);
  const [error, setError] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [gradingTest, setGradingTest] = useState(null);

  const loadTests = async () => {
    setError('');
    try {
      setTests(await apiRequest('/api/grading/tests'));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadTests();
    apiRequest('/api/academics/classes').then(setClasses).catch(() => {});
  }, []);

  const openForGrading = async (test) => {
    try {
      const full = await apiRequest(`/api/grading/tests/${test.id}`);
      setGradingTest(full);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-ink flex items-center gap-2">
            <GraduationCap className="w-7 h-7 text-terracotta" /> AI Grading
          </h1>
          <p className="text-sm text-ink-soft mt-1">Generate tests, grade answer-sheet photos, review before anything's final.</p>
        </div>
        <button onClick={() => setShowGenerate(true)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep">
          <Plus className="w-4 h-4" /> Generate test
        </button>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="space-y-2">
        <div className="font-display text-lg text-ink">Tests</div>
        {tests === null ? (
          <div className="text-sm text-ink-soft py-4">Loading…</div>
        ) : tests.length === 0 ? (
          <div className="rounded-2xl bg-white border border-cream-deep/70 p-6 text-center text-sm text-ink-soft">No tests yet — generate one to get started.</div>
        ) : (
          <div className="rounded-2xl bg-white border border-cream-deep/70 divide-y divide-cream-deep/60 overflow-hidden">
            {tests.map((t) => (
              <div key={t.id} className="p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-ink">{t.title}</div>
                  <div className="text-xs text-ink-soft">{t.subject_id} · {t.chapter_id} · {t.difficulty} · {t.question_count} question{t.question_count === 1 ? '' : 's'}</div>
                </div>
                <button onClick={() => openForGrading(t)} className="px-3 py-1.5 rounded-lg bg-white border border-cream-deep text-ink text-sm font-medium hover:bg-cream-deep/40 shrink-0">
                  Grade answers
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <PendingReviewQueue />

      {showGenerate && <GenerateTestModal classes={classes} onClose={() => setShowGenerate(false)} onCreated={loadTests} />}
      {gradingTest && <SubmitAnswerPanel test={gradingTest} onClose={() => setGradingTest(null)} onSubmitted={() => {}} />}
    </div>
  );
}
