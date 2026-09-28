// WhatsApp consent keywords. Kept deliberately strict (whole message only)
// so a sentence that merely contains "stop" ("bus stop kahan hai?") is never
// treated as an opt-out.
const STOP_WORDS = new Set([
  'stop', 'stop messages', 'unsubscribe', 'opt out', 'optout',
  'band karo', 'band kro', 'mat bhejo', 'message mat bhejo',
  'बंद करो', 'मत भेजो', 'ਬੰਦ ਕਰੋ', 'ਨਾ ਭੇਜੋ',
]);
const START_WORDS = new Set([
  'start', 'unstop', 'subscribe', 'opt in', 'optin', 'shuru karo', 'chalu karo',
]);

export function consentKeyword(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!\s]+$/u, '').replace(/\s+/g, ' ');
  if (STOP_WORDS.has(t)) return 'stop';
  if (START_WORDS.has(t)) return 'start';
  return null;
}
