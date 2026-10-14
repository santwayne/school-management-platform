// Parses a teacher's WhatsApp message into a homework / lesson-plan draft or a
// share command. Pure — no database — so it is unit-tested directly.
//
//   HOMEWORK 7A Maths: Chapter 4 exercises        (first line = header)
//   Solve Q1-10, page 45                          (following lines = details)
//   due 2026-10-20                                (optional, ISO or dd/mm/yyyy)
//
//   LESSON PLAN 7A Maths: Fractions intro
//   SHARE HW 12   |   SHARE LP 5
// A photo/document sent with one of these as its caption becomes the attachment.

const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function parseDue(line) {
  const m = /^due[:\s]+(.+)$/i.exec(line.trim());
  if (!m) return null;
  const raw = m[1].trim();
  let iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return undefined; // a due line we could not read
}

export function parseTeacherCommand(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  const share = /^share\s+(hw|homework|lp|lesson(?:\s*plan)?)\s+#?(\d+)\s*$/i.exec(t);
  if (share) {
    return { type: 'share', kind: /^h/i.test(share[1]) ? 'homework' : 'lesson_plan', id: Number(share[2]) };
  }

  const lines = t.split(/\r?\n/);
  const head = /^(homework|hw|lesson\s*plan|lessonplan|lp)\b\s*(.*)$/i.exec(lines[0].trim());
  if (!head) return null;
  const kind = /^h/i.test(head[1]) ? 'homework' : 'lesson_plan';
  const rest = head[2];
  const colon = rest.indexOf(':');
  if (colon === -1) return { type: 'draft', kind, error: 'missing_title' };
  const header = rest.slice(0, colon).trim();
  const title = rest.slice(colon + 1).trim();
  if (!title) return { type: 'draft', kind, error: 'missing_title' };

  let dueDate = null;
  const detailLines = [];
  for (const line of lines.slice(1)) {
    const due = parseDue(line);
    if (due === undefined) return { type: 'draft', kind, error: 'bad_due' };
    if (due) dueDate = due;
    else detailLines.push(line);
  }
  return { type: 'draft', kind, header, title, details: detailLines.join('\n').trim(), dueDate };
}

// Picks the one { class_id, subject_id } pair the header names, from the pairs
// this teacher teaches. Returns null unless exactly one fits ("7A Maths").
export function matchClassSubject(header, options) {
  const h = norm(header);
  if (!h) return null;
  const hits = options.filter((o) => h.includes(norm(o.class_name)) && h.includes(norm(o.subject_name)));
  if (hits.length === 1) return hits[0];
  // "7A" alone is enough when the teacher only teaches one subject there.
  const byClass = options.filter((o) => h.includes(norm(o.class_name)));
  const classes = new Set(byClass.map((o) => o.class_id));
  return classes.size === 1 && byClass.length === 1 ? byClass[0] : null;
}
