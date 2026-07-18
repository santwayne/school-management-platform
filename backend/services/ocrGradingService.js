import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
      max_tokens: 500,
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
    const raw = textBlock ? textBlock.text.trim() : '{}';
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '');
    const parsed = JSON.parse(cleaned);

    return {
      extractedText: parsed.extracted_text || '',
      score: typeof parsed.score === 'number' ? Math.max(0, Math.min(maxMarks, parsed.score)) : 0,
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
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const raw = textBlock ? textBlock.text.trim() : '{}';
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '');
    const parsed = JSON.parse(cleaned);

    return {
      score: typeof parsed.score === 'number' ? Math.max(0, Math.min(maxMarks, parsed.score)) : 0,
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
    max_tokens: 1200,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Generate ${questionCount} exam questions for subject "${subject}", chapter "${chapter}", difficulty "${difficulty}". Each needs a model correct_answer suitable for grading a student's handwritten response against.`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const cleaned = (textBlock?.text || '[]').trim().replace(/^```json\s*|\s*```$/g, '');
  return JSON.parse(cleaned);
}
