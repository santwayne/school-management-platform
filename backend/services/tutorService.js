import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---- Cost settings (all overridable from .env) ----
// The tutor is the biggest AI cost in Waynur, so it runs on a fast, cheaper
// model by default. Set TUTOR_MODEL=claude-sonnet-5 to go back to Sonnet.
export const TUTOR_MODEL = process.env.TUTOR_MODEL || 'claude-haiku-4-5';
const TUTOR_MAX_TOKENS = Number(process.env.TUTOR_MAX_TOKENS) || 300;
// How much of the current session is re-sent each turn. The FULL session is
// still saved in tutor_sessions and still used by the student-memory review —
// this only limits what goes to the model on every single turn.
const HISTORY_MIN_KEEP = Number(process.env.TUTOR_HISTORY_MIN_KEEP) || 12;
const HISTORY_STEP = Number(process.env.TUTOR_HISTORY_STEP) || 8;
export const TUTOR_MAX_MESSAGE_CHARS = Number(process.env.TUTOR_MAX_MESSAGE_CHARS) || 2000;

// Part 1 — identical for EVERY student in every school. Keeping it word-for-word
// fixed is what lets it be served from Anthropic's prompt cache. It contains no
// student data, so sharing the cache never shares anything about a student.
export const TUTOR_RULES = `You are a patient, encouraging home tutor helping a school student with a homework question.

Rules you must always follow:
- Never give the final answer immediately.
- On the student's first message on a new question, ask what they've already tried, or ask one guiding question that points them toward the concept — don't lecture.
- Break the problem into smaller steps and reveal only one step at a time.
- Look at the conversation so far: if the student has made 2 genuine attempts and is still stuck, give a stronger hint (not the answer) — e.g. "Think about what happens to speed when force is removed." A "genuine attempt" means they engaged with the concept; random guesses don't count — gently discourage guessing and ask them to reason instead.
- Only give the direct final answer if the student explicitly says something like "just tell me the answer." Even then, give the answer AND explain the reasoning after — don't just state it bare.
- Adjust your vocabulary, sentence length, and examples to the student's grade/class given in the session details — simpler and more concrete for younger students, more technical for older ones.
- Encourage the student when they get closer to the answer. Keep responses short (2-4 sentences) — this is a back-and-forth chat (often spoken aloud), not an essay. No long lists, no markdown tables.
- Stay on schoolwork. If the student drifts to unrelated chat, kindly bring them back to their studies in one sentence.
- Respond in the same language the student writes in (English, Hindi, Punjabi, or a mix).
- If session details include what you know about the student from earlier sessions, use it like a teacher who knows them well: build on strengths, go gently where they struggle, use their interests in examples; never recite it back to them or mention that you keep notes.`;

// Part 2 — this student only: session details + their FULL learning memory.
// Cached per student, so within a session it is paid for once, not every turn.
export function buildStudentBlock(subject, grade, studentContext = '') {
  return `Session details:
- Grade/class: ${grade || 'unspecified'}
- Subject: ${subject || 'general'}${studentContext ? `

What you already know about this student from earlier sessions:
${studentContext}` : ''}`;
}

// Kept for anything that still wants one plain string.
export function buildSystemPrompt(subject, grade, studentContext = '') {
  return `${TUTOR_RULES}\n\n${buildStudentBlock(subject, grade, studentContext)}`;
}

// Which part of the session to re-send. Instead of sliding by one message
// every turn (which would change the cached prefix every time and kill the
// cache), the window jumps forward in blocks of HISTORY_STEP messages, so the
// same prefix is reused for several turns in a row. Always starts on a
// student ('user') message and always keeps at least HISTORY_MIN_KEEP.
export function windowHistory(history = [], minKeep = HISTORY_MIN_KEEP, step = HISTORY_STEP) {
  const len = history.length;
  if (len <= minKeep) return history;
  const evenStep = Math.max(2, step - (step % 2));
  let start = Math.floor((len - minKeep) / evenStep) * evenStep;
  while (start > 0 && history[start]?.role !== 'user') start -= 1;
  return history.slice(start);
}

export function buildRequest(conversationHistory, newMessage, subject, grade, studentContext = '') {
  const kept = windowHistory(conversationHistory);
  const messages = kept.map((m) => ({ role: m.role, content: m.content }));
  // Cache breakpoint on the last earlier message: everything up to it is read
  // from cache on the next turn instead of being paid at full price again.
  if (messages.length) {
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = {
      role: last.role,
      content: [{ type: 'text', text: String(last.content), cache_control: { type: 'ephemeral' } }],
    };
  }
  messages.push({ role: 'user', content: newMessage });

  return {
    model: TUTOR_MODEL,
    max_tokens: TUTOR_MAX_TOKENS,
    system: [
      { type: 'text', text: TUTOR_RULES, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: buildStudentBlock(subject, grade, studentContext), cache_control: { type: 'ephemeral' } },
    ],
    messages,
  };
}

// conversationHistory: array of { role: 'user' | 'assistant', content: string }
// newMessage: the student's latest message (not yet in conversationHistory)
// Returns { text, usage, model } so the route can meter the call.
export async function askTutor(conversationHistory, newMessage, subject, grade, studentContext = '') {
  if (!process.env.ANTHROPIC_API_KEY) {
    // Fail loudly and immediately rather than letting the SDK call fail deep
    // inside the try/catch below with a less obvious auth error.
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  // Errors propagate so the route can return a real error status and skip
  // persisting a bogus assistant turn (see routes/tutor.js).
  const response = await anthropic.messages.create(
    buildRequest(conversationHistory, newMessage, subject, grade, studentContext)
  );

  const textBlock = response.content.find((b) => b.type === 'text');
  return {
    text: textBlock ? textBlock.text : "Let's slow down — can you tell me what you already know about this?",
    usage: response.usage || null,
    model: response.model || TUTOR_MODEL,
  };
}
