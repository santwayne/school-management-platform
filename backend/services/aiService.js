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

// Reads a photographed cash receipt/slip and proposes an amount + student
// name. This is ONLY ever a proposal — the whatsapp_cash_intake row stays
// PENDING until a human (Accountant/Principal) confirms it in the review
// queue. A misread number here is real money, so nothing downstream treats
// this as final.
export async function extractCashSlip(base64Image, mimeType) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 300,
      system:
        'You read photos of handwritten or printed school fee cash receipts. ' +
        'Extract the rupee amount and, if legible, the student name or roll number. ' +
        'Respond ONLY as JSON: {"amount": <number or null>, "student_hint": <string or null>, "confidence": "high"|"medium"|"low"}. ' +
        'If the amount is not clearly legible, set amount to null rather than guessing.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
            { type: 'text', text: 'Extract the fee amount and student name/roll number from this receipt.' },
          ],
        },
      ],
    });
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock) return { amount: null, student_hint: null, confidence: 'low' };
    try {
      return JSON.parse(textBlock.text);
    } catch {
      return { amount: null, student_hint: null, confidence: 'low' };
    }
  } catch (err) {
    console.error('Cash slip extraction failed:', err.message);
    return { amount: null, student_hint: null, confidence: 'low' };
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

// Reads a photo a parent/student sends over WhatsApp of a homework problem,
// textbook page, or handwritten question, and turns it into the question
// text so the normal doubt-solving pipeline (generateAIHint + tagDoubtChapter)
// can run on it exactly like a typed message would. This replaces what was
// previously a hardcoded "OCR not configured" placeholder — Claude vision
// reads the photo directly rather than needing a separate OCR provider.
export async function extractDoubtImage(base64Image, mimeType) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 400,
      system:
        'A student or parent has sent a photo over WhatsApp — likely a homework question, textbook page, or handwritten problem. ' +
        'Transcribe the actual question(s) being asked, in plain text, as if the student had typed it themselves. ' +
        'If the image is unclear, blurry, or not actually a question, say so plainly instead of guessing.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
            { type: 'text', text: 'What question is being asked in this image? Transcribe it.' },
          ],
        },
      ],
    });
    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock ? textBlock.text.trim() : "I received the image but couldn't make out a clear question in it.";
  } catch (err) {
    console.error('Doubt image extraction failed:', err.message);
    return "I received your image but I'm having trouble reading it right now — could you try describing your question in text?";
  }
}
