import React, { useState } from 'react';
import { apiRequest } from '../api';

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
    <div className="p-6 max-w-4xl mx-auto bg-slate-50 rounded-xl border mt-10">
      <div className="mb-6">
        <span className="text-xs font-bold uppercase tracking-widest bg-purple-100 text-purple-800 px-3 py-1 rounded-full">
          Phase 5 — High Risk Prototype
        </span>
        <h2 className="text-2xl font-black text-slate-900 mt-2">OCR Answer-Sheet AI Evaluator</h2>
        <p className="text-sm text-slate-500">Test AI response scoring accuracy before deploying to live schools.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Student ID</label>
              <input
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="w-full p-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Test ID</label>
              <input
                value={testId}
                onChange={(e) => setTestId(e.target.value)}
                className="w-full p-2 border rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Extracted Handwritten OCR Text</label>
            <textarea
              rows={6}
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              className="w-full p-3 border rounded-xl text-sm font-mono bg-white shadow-inner focus:ring-2 focus:ring-purple-500 focus:outline-none"
            />
          </div>
          <button
            onClick={handleStartGrading}
            disabled={loading}
            className="w-full bg-purple-700 text-white font-bold p-3 rounded-xl hover:bg-purple-800 transition shadow disabled:opacity-50"
          >
            {loading ? 'AI Evaluation in Progress...' : 'Run AI Grading Verification'}
          </button>
          {error && <div className="p-3 text-xs bg-red-50 text-red-700 rounded-lg border border-red-200">{error}</div>}
          <p className="text-[11px] text-slate-400">
            Note: this calls a rubric-backed endpoint — a `test_rubrics` row must exist for this test_id/question_num
            first.
          </p>
        </div>

        <div className="bg-white border rounded-xl p-5 flex flex-col justify-between shadow-sm">
          <div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">AI Engine Output</h3>

            {result ? (
              <div className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold text-purple-700">{result.score}</span>
                  <span className="text-lg text-slate-400 font-bold">/ 10 Marks</span>
                </div>
                <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                  <h4 className="text-xs font-bold text-purple-900 uppercase">AI Justification:</h4>
                  <p className="text-sm text-purple-950 mt-1 italic">"{result.justification}"</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">Submit the sample text on the left to test the LLM evaluation logic.</p>
            )}
          </div>

          <div className="mt-4 pt-3 border-t text-[11px] text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
            <strong>Risk Warning:</strong> OCR faults can alter context. Always maintain a Teacher-in-the-loop fallback mechanism.
          </div>
        </div>
      </div>
    </div>
  );
}
