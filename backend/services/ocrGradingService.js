import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Pull the JSON payload out of a model reply even when it is wrapped in
// ```json fences or surrounded by prose — a strict JSON.parse of the raw text
// was the main reason grading/test generation intermittently failed.
function parseModelJson(raw, open = '{', close = '}') {
  const text = String(raw || '').trim();
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start === -1 || end <= start) throw new Error('Model reply contained no JSON');
  return JSON.parse(text.slice(start, end + 1));
}

function toScore(value, maxMarks) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? Math.max(0, Math.min(maxMarks, n)) : 0;
}

// Production path: send the actual answer-sheet photo to Claude directly
// rather than running a separate OCR step first. Claude reads handwriting
// well enough that a two-stage OCR-then-grade pipeline just adds a second
// place for errors to creep in — one vision call does both, and we ask the
// model to report its own extraction confidence so low-confidence reads get
// flagged for teacher review instead of silently trusted.
//
// imageBase64: raw base64 (no data: prefix), mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
export async function gradeAnswerSheetImage({ imageBase64, mediaType, question, correctAnswer, maxMarks }) {
  const systemPrompt = `You are an automated school exam grader.
You will be shown a photograph of a student's handwritten answer sheet (or a crop of it).

Rules:
1. First, transcribe exactly what the student wrote for this question, as best you can read it.
2. Compare it against the official correct answer / rubric provided.
3. Score out of ${maxMarks} marks, giving partial credit for partially correct answers.
4. If the handwriting is illegible, ambiguous, or the photo is unclear, say so explicitly and score conservatively — never guess a favorable score.
5. Report your own confidence in the transcription as "high", "medium", or "low".
6. Return ONLY a JSON object, no other text: { "extracted_text": "<string>", "score": <number>, "max_marks": ${maxMarks}, "justification": "<string>", "confidence": "high"|"medium"|"low" }`;

  const userText = `Question: "${question || '(question text not provided)'}"\nOfficial correct answer / rubric: "${correctAnswer}"\nMaximum marks: ${maxMarks}\n\nGrade the student's answer shown in the image.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: userText },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const parsed = parseModelJson(textBlock?.text);

    return {
      extractedText: parsed.extracted_text || '',
      score: toScore(parsed.score, maxMarks),
      maxMarks,
      justification: parsed.justification || 'Could not evaluate this answer automatically.',
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    };
  } catch (err) {
    console.error('Image grading failed:', err.message);
    return {
      extractedText: '',
      score: 0,
      maxMarks,
      justification: 'AI grading failed (could not process image) — flagged for manual teacher review.',
      confidence: 'low',
    };
  }
}

// Text-only path — kept for programmatic/API submissions where OCR text is
// already available from an external source (e.g. a typed answer, or OCR
// done upstream). The image path above is the primary production flow.
export async function gradeAnswerSheetWithAI(extractedStudentText, correctSyllabusAnswer, maxMarks = 10) {
  const systemPrompt = `You are an automated School Board Examiner.
Analyze the student's text against the official Correct Answer Key.

Rules:
1. Provide a score out of ${maxMarks}, with partial credit where appropriate.
2. Provide brief, constructive feedback explaining why marks were deducted, if any.
3. If the text looks garbled or nonsensical, say so in the justification and score conservatively rather than guessing.
4. Return ONLY a JSON object, no other text: { "score": <number>, "justification": "<string>" }`;

  const userPrompt = `Official Correct Answer: "${correctSyllabusAnswer}"\nStudent's Answer: "${extractedStudentText}"\nMaximum marks: ${maxMarks}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const parsed = parseModelJson(textBlock?.text);

    return {
      score: toScore(parsed.score, maxMarks),
      justification: parsed.justification || 'Could not evaluate this answer automatically.',
    };
  } catch (err) {
    console.error('OCR grading failed:', err.message);
    return {
      score: 0,
      justification: 'AI grading failed — flagged for manual teacher review.',
    };
  }
}

// Generates a test's questions AND a correct-answer rubric for each, in one
// call — closes the previous gap where a generated test had no rubric until
// someone manually typed correct answers in later.
export async function generateTestWithRubric({ subject, chapter, difficulty, questionCount = 5 }) {
  const systemPrompt = `You are a school exam-paper setter. Return ONLY a JSON array, no other text, of objects:
{ "q_num": <int>, "question": "<string>", "marks": <int>, "correct_answer": "<string, a model answer used for grading>" }`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: Math.min(8000, 400 + Number(questionCount) * 450),
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Generate ${questionCount} exam questions for subject "${subject}", chapter "${chapter}", difficulty "${difficulty}". Each needs a model correct_answer suitable for grading a student's handwritten response against.`,
      },
    ],
 }, { timeout: 4 * 60 * 1000 });

  const textBlock = response.content.find((b) => b.type === 'text');
  const questions = parseModelJson(textBlock?.text, '[', ']');
  if (!Array.isArray(questions) || questions.length === 0) throw new Error('Model returned no questions');
  // Normalise so downstream inserts/lookups never see string q_num/marks.
  return questions.map((q, i) => ({
    q_num: Number(q.q_num) || i + 1,
    question: String(q.question || ''),
    marks: Number(q.marks) > 0 ? Number(q.marks) : 10,
    correct_answer: String(q.correct_answer || ''),
  }));
}
