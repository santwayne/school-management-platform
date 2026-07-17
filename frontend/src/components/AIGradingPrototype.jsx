import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';

function PendingReviewQueue() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overrides, setOverrides] = useState({});

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await apiRequest('/api/grading/pending'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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
    <div className="mt-10 pt-8 border-t">
      <div className="mb-4">
        <span className="text-xs font-bold uppercase tracking-widest bg-amber-100 text-amber-800 px-3 py-1 rounded-full">
          Teacher review required before any grade is final
        </span>
        <h2 className="font-display text-xl font-black text-ink mt-2">Pending grading review</h2>
        <p className="text-sm text-ink-soft">Nothing here counts as a real grade until a teacher confirms or overrides it.</p>
      </div>

      {error && <div className="p-3 mb-4 text-xs bg-destructive/10 text-destructive rounded-lg border border-red-200">{error}</div>}

      {loading ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-soft italic">Nothing waiting on review right now.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="bg-white border rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
              <div className="flex-1">
                <div className="text-sm font-semibold text-ink">{r.student_name} — Test #{r.test_id}, Q{r.question_num}</div>
                <p className="text-xs text-ink-soft mt-1 italic">"{r.extracted_text}"</p>
                <p className="text-xs text-terracotta-deep mt-1">AI justification: {r.justification}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <div className="text-xs text-ink-soft">AI score</div>
                  <div className="text-lg font-bold text-terracotta-deep">{r.ai_score}</div>
                </div>
                <input
                  type="number"
                  placeholder="Override"
                  value={overrides[r.id] ?? ''}
                  onChange={(e) => setOverrides({ ...overrides, [r.id]: e.target.value })}
                  className="w-24 p-2 border rounded-lg text-sm"
                />
                <button
                  onClick={() => confirm(r.id)}
                  className="px-3 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep transition"
                >
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

export default function AIGradingPrototype() {
  const [ocrText, setOcrText] = useState('Energy cannot be created but can be destroyed when it changes forms.');
  const [studentId, setStudentId] = useState('101');
  const [testId, setTestId] = useState('50');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleStartGrading = async () => {
    setLoading(true);
    setResult(null);
    setError('');

    try {
      const data = await apiRequest('/api/premium-ai/ocr/grade', {
        method: 'POST',
        body: {
          student_id: parseInt(studentId, 10),
          test_id: parseInt(testId, 10),
          question_num: 1,
          ocr_text: ocrText,
        },
      });
      if (data.success) setResult(data.evaluation);
    } catch (err) {
      setError(err.message || 'Grading pipeline failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto bg-cream rounded-xl border mt-10">
      <div className="mb-6">
        <span className="text-xs font-bold uppercase tracking-widest bg-terracotta/10 text-terracotta-deep px-3 py-1 rounded-full">
          Phase 5 — High Risk Prototype
        </span>
        <h2 className="font-display text-2xl font-black text-ink mt-2">OCR Answer-Sheet AI Evaluator</h2>
        <p className="text-sm text-ink-soft">Test AI response scoring accuracy before deploying to live schools.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink-soft uppercase mb-1">Student ID</label>
              <input
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="w-full p-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-ink-soft uppercase mb-1">Test ID</label>
              <input
                value={testId}
                onChange={(e) => setTestId(e.target.value)}
                className="w-full p-2 border rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-ink-soft uppercase mb-1">Extracted Handwritten OCR Text</label>
            <textarea
              rows={6}
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              className="w-full p-3 border rounded-xl text-sm font-mono bg-white shadow-inner focus:ring-2 focus:ring-terracotta/40 focus:outline-none"
            />
          </div>
          <button
            onClick={handleStartGrading}
            disabled={loading}
            className="w-full bg-terracotta text-white font-bold p-3 rounded-xl hover:bg-terracotta-deep transition shadow disabled:opacity-50"
          >
            {loading ? 'AI Evaluation in Progress...' : 'Run AI Grading Verification'}
          </button>
          {error && <div className="p-3 text-xs bg-destructive/10 text-destructive rounded-lg border border-red-200">{error}</div>}
          <p className="text-[11px] text-ink-soft">
            Note: this calls a rubric-backed endpoint — a `test_rubrics` row must exist for this test_id/question_num
            first.
          </p>
        </div>

        <div className="bg-white border rounded-xl p-5 flex flex-col justify-between shadow-sm">
          <div>
            <h3 className="text-sm font-bold text-ink uppercase tracking-wider mb-3">AI Engine Output</h3>

            {result ? (
              <div className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold text-terracotta-deep">{result.score}</span>
                  <span className="text-lg text-ink-soft font-bold">/ 10 Marks</span>
                </div>
                <div className="p-3 bg-terracotta/5 rounded-lg border border-terracotta/20">
                  <h4 className="text-xs font-bold text-terracotta-deep uppercase">AI Justification:</h4>
                  <p className="text-sm text-terracotta-deep mt-1 italic">"{result.justification}"</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-soft italic">Submit the sample text on the left to test the LLM evaluation logic.</p>
            )}
          </div>

          <div className="mt-4 pt-3 border-t text-[11px] text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
            <strong>Risk Warning:</strong> OCR faults can alter context. Always maintain a Teacher-in-the-loop fallback mechanism.
          </div>
        </div>
      </div>

      <PendingReviewQueue />
    </div>
  );
}
