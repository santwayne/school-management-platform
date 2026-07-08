import axios from 'axios';

// Triggers an outbound AI voice call via Vapi, using the Sarvam Bulbul v3
// Hindi/Punjabi assistant already configured for VoCallM (same pattern,
// reused here rather than rebuilt).
export async function triggerEscalationCall(parentPhone, { studentName, language = 'hi' } = {}) {
  const assistantId =
    language === 'pa' ? process.env.VAPI_ASSISTANT_ID_PUNJABI : process.env.VAPI_ASSISTANT_ID_HINDI;

  const { data } = await axios.post(
    'https://api.vapi.ai/call/phone',
    {
      assistantId,
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
      customer: { number: parentPhone },
      assistantOverrides: {
        variableValues: { student_name: studentName || 'your child' },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );

  return data; // includes Vapi call id, used later to reconcile call_outcomes
}
