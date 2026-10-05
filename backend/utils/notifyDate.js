// Dates shown to parents/staff inside WhatsApp + dashboard notifications.
//
// Postgres DATE columns arrive from `pg` as a JS Date at LOCAL midnight.
// Passing that straight into a template printed
// "Thu Oct 08 2026 00:00:00 GMT+0530 (India Standard Time)", and
// toISOString().slice(0, 10) printed the PREVIOUS day (local midnight in
// IST is 18:30 UTC the day before). Read the local calendar parts instead.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// -> "8 Oct 2026". Accepts a Date or a 'YYYY-MM-DD...' string; anything
// else is returned as text unchanged so a notification never throws.
export function formatNotifyDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getDate()} ${MONTHS[value.getMonth()]} ${value.getFullYear()}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return String(value);
}
