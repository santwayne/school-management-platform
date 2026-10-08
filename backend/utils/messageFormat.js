// Small formatters for values that go into WhatsApp template variables.
//
// Postgres NUMERIC columns arrive as strings like "3.0" or "0.0", and
// ROUND(..., 1) keeps the ".0". In a message that reads as "3.0 day(s)" or
// "0.0%", which parents and principals took for a glitch.

// "3.0" -> "3", "2.50" -> "2.5", 66.666 -> "66.7", null -> "0".
export function formatCount(value, maxDecimals = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(n * factor) / factor;
  return String(rounded);
}

// For a variable that the approved template follows with its own full stop
// ("... Suggested activity: {{4}}. Have a great teaching day!"). Text that
// already ends with one gave "questions.. Have".
export function withoutTrailingFullStop(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
}
