import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Pedagogical Prompting Pattern — the AI must never hand the student the
// final answer, only guide them toward it. This rule stays true across
// text, voice-transcribed, and OCR'd image doubts.
const SYSTEM_PROMPT = `You are an expert AI Teacher for a school student.
Strict rule: NEVER give the final direct answer.
Instead, guide the student toward the solution with step-by-step hints and
encourage critical thinking. Keep your response concise (3-5 sentences),
simple, and encouraging. Respond in the same language the student wrote in.`;

export async function generateAIHint(studentQuery) {
  if (!studentQuery || !studentQuery.trim()) {
    return "I couldn't read your question — could you send it again?";
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: studentQuery }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock ? textBlock.text : 'Let\u2019s try breaking that question into smaller steps — what do you already know about it?';
  } catch (err) {
    console.error('AI hint generation failed:', err.message);
    return "I'm having trouble reaching the AI tutor right now — a teacher will follow up on this doubt.";
  }
}

// Chapter tagging so recurring doubts can be surfaced to the teacher
// (Section 4 of the spec: same doubt across many students => re-teach signal).
export async function tagDoubtChapter(studentQuery, syllabusChapters = []) {
  if (!syllabusChapters.length) return 'Untagged';

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 30,
      system:
        'Reply with ONLY the single best-matching chapter name from the provided list, nothing else. If none match, reply "Untagged".',
      messages: [
        {
          role: 'user',
          content: `Chapters: ${syllabusChapters.join(', ')}\n\nStudent question: ${studentQuery}`,
        },
      ],
    });
    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock ? textBlock.text.trim() : 'Untagged';
  } catch (err) {
    console.error('Chapter tagging failed:', err.message);
    return 'Untagged';
  }
}
