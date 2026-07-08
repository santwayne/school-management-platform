import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Phase 5 / Tier 3 — highest-risk piece per the spec's own notes-for-Sant.
// Kept as an isolated service so it can be prototyped and tested against
// real handwriting samples before being promised to any school, without
// touching the core attendance/homework flows.
export async function gradeAnswerSheetWithAI(extractedStudentText, correctSyllabusAnswer) {
  const systemPrompt = `You are an automated School Board Examiner.
Analyze the student's handwritten text (extracted via OCR) against the official Correct Answer Key.

Rules:
1. Provide a score out of 10.
2. Provide brief, constructive feedback explaining why marks were deducted, if any.
3. If the OCR text looks garbled or nonsensical, say so in the justification and score conservatively rather than guessing.
4. Return ONLY a JSON object, no other text: { "score": <number>, "justification": "<string>" }`;

  const userPrompt = `Official Correct Answer: "${correctSyllabusAnswer}"
Student's OCR Extracted Answer: "${extractedStudentText}"`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const raw = textBlock ? textBlock.text.trim() : '{}';
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '');
    const parsed = JSON.parse(cleaned);

    return {
      score: typeof parsed.score === 'number' ? parsed.score : 0,
      justification: parsed.justification || 'Could not evaluate this answer automatically.',
    };
  } catch (err) {
    console.error('OCR grading failed:', err.message);
    // Fail safe to a 0 + teacher-review flag rather than a crash or a
    // silently wrong score — a human always checks a failed AI grade.
    return {
      score: 0,
      justification: 'AI grading failed — flagged for manual teacher review.',
    };
  }
}
