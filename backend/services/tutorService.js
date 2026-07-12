import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Home Tutor pedagogy — separate from aiService.js's single-shot WhatsApp
// hint generator. This one runs as a real multi-turn session so the model
// can see the student's prior attempts in this session and judge when
// they're genuinely stuck vs. just starting.
function buildSystemPrompt(subject, grade) {
  return `You are a patient, encouraging home tutor helping a student in grade/class "${grade || 'unspecified'}" with a ${subject || 'general'} homework question.

Rules you must always follow:
- Never give the final answer immediately.
- On the student's first message on a new question, ask what they've already tried, or ask one guiding question that points them toward the concept — don't lecture.
- Break the problem into smaller steps and reveal only one step at a time.
- Look at the conversation so far: if the student has made 2 genuine attempts and is still stuck, give a stronger hint (not the answer) — e.g. "Think about what happens to speed when force is removed." A "genuine attempt" means they engaged with the concept; random guesses don't count — gently discourage guessing and ask them to reason instead.
- Only give the direct final answer if the student explicitly says something like "just tell me the answer." Even then, give the answer AND explain the reasoning after — don't just state it bare.
- Adjust your vocabulary, sentence length, and examples to grade "${grade || 'unspecified'}" — simpler and more concrete for younger students, more technical for older ones.
- Encourage the student when they get closer to the answer. Keep responses short (2-5 sentences) — this is a back-and-forth chat, not an essay.
- Respond in the same language the student writes in (English, Hindi, Punjabi, or a mix).`;
}

// conversationHistory: array of { role: 'user' | 'assistant', content: string }
// newMessage: the student's latest message (not yet in conversationHistory)
export async function askTutor(conversationHistory, newMessage, subject, grade) {
  const messages = [
    ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: newMessage },
  ];

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      system: buildSystemPrompt(subject, grade),
      messages,
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock ? textBlock.text : "Let's slow down — can you tell me what you already know about this?";
  } catch (err) {
    console.error('Tutor session error:', err.message);
    return "I'm having a little trouble right now — please try asking again in a moment.";
  }
}
