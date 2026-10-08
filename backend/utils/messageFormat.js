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

// Money in a message: "500.00" -> "500", "1250.50" -> "1,250.50". Whole
// rupees drop the paise; anything else keeps two decimals.
export function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const whole = Number.isInteger(Math.round(n * 100) / 100);
  return n.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

// "1 day", "3 days", "0.5 day", "2.5 days". The approved templates used to
// carry a literal "day(s)" after the number; the unit now travels with it.
export function daysLabel(value) {
  const count = formatCount(value);
  return Number(count) > 1 ? `${count} days` : `${count} day`;
}

// One WhatsApp variable holding the librarian's overdue list:
// "Maths Book 6 - Aarav Mehta (Class 6A), 3 days late; ... and 4 more".
// Meta rejects a variable containing a newline, a tab or more than four
// spaces in a row, so every item is flattened to a single line.
export function overdueListText(items, maxItems = 5) {
  const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const list = Array.isArray(items) ? items : [];
  const shown = list.slice(0, maxItems).map((item) => {
    const who = clean(item.borrower) || 'unknown borrower';
    const cls = clean(item.className);
    return `${clean(item.title) || 'Untitled book'} - ${who}${cls ? ` (${cls})` : ''}, ${daysLabel(item.daysLate)} late`;
  });
  const rest = list.length - shown.length;
  return shown.join('; ') + (rest > 0 ? ` and ${rest} more` : '');
}

// The librarian's daily digest.
//   library_overdue_digest: {{1}} overdue count, {{2}} the overdue list,
//                           {{3}} books due today or tomorrow.
//   library_due_digest (earlier): {{1}} due soon, {{2}} overdue - two bare
//     counts, which gave the librarian nothing to act on.
// The variables must match whichever template is sent, so the shape follows
// the name. WHATSAPP_LIBRARY_DIGEST_TEMPLATE=library_due_digest keeps the old
// message going, e.g. while the new template is still in Meta review.
export const DEFAULT_LIBRARY_DIGEST_TEMPLATE = 'library_overdue_digest';
export const LEGACY_LIBRARY_DIGEST_TEMPLATE = 'library_due_digest';

export function libraryDigestParams(templateName, { dueSoon = 0, overdueItems = [] } = {}) {
  if (templateName === LEGACY_LIBRARY_DIGEST_TEMPLATE) return [String(dueSoon), String(overdueItems.length)];
  return [String(overdueItems.length), overdueListText(overdueItems), String(dueSoon)];
}
