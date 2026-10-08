// Working out which chapter a parent's homework doubt belongs to.
//
// Every real doubt in the 7 Oct test was stored as "Untagged", so the weekly
// recurring-doubt alert had nothing to count. Three things caused it:
//   1. a parent with more than one child got no chapter list at all;
//   2. a class whose syllabus dates are missing or outside the current
//      window got no chapter list either;
//   3. whatever the AI replied was stored as-is, so "Fractions." or a short
//      sentence never matched the syllabus chapter it meant.

export const UNTAGGED = 'Untagged';

const key = (text) => String(text ?? '').toLowerCase().replace(/["'`.]/g, ' ').replace(/\s+/g, ' ').trim();

// rows: syllabus_calendar rows for the children's classes, each
// { class_id, chapter_name, in_window }. A class with chapters in the current
// window offers only those; a class with none offers its whole syllabus, so a
// school that never dated its chapters still gets doubts tagged.
// -> Map of class_id -> [chapter names]
export function chaptersByClass(rows) {
  const current = new Map();
  const all = new Map();
  for (const row of rows || []) {
    const name = String(row.chapter_name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const add = (map) => {
      if (!map.has(row.class_id)) map.set(row.class_id, []);
      if (!map.get(row.class_id).some((n) => key(n) === key(name))) map.get(row.class_id).push(name);
    };
    add(all);
    if (row.in_window) add(current);
  }
  const result = new Map();
  for (const [classId, names] of all) result.set(classId, current.get(classId) || names);
  return result;
}

// Every chapter the AI may choose from, across all the parent's children.
export function chapterChoices(byClass) {
  const names = [];
  for (const list of byClass.values()) {
    for (const name of list) if (!names.some((n) => key(n) === key(name))) names.push(name);
  }
  return names;
}

// The AI's reply, held to the list it was given. Returns the chapter exactly
// as the syllabus spells it, or "Untagged".
export function matchChapter(reply, choices) {
  const said = key(reply);
  if (!said || said === key(UNTAGGED)) return UNTAGGED;
  const exact = choices.find((name) => key(name) === said);
  if (exact) return exact;
  // "Chapter: Fractions and Decimals" - the reply contains exactly one chapter name.
  const inside = choices.filter((name) => key(name) && said.includes(key(name)));
  if (inside.length === 0) return UNTAGGED;
  // "Fractions" and "Fractions and Decimals" both appear: the longer is meant.
  inside.sort((a, b) => key(b).length - key(a).length);
  return inside.length === 1 || key(inside[0]).length > key(inside[1]).length ? inside[0] : UNTAGGED;
}

// Which child the doubt is about. One child: that child. Several: the one
// whose class teaches the tagged chapter, if only one does; otherwise unknown
// (null) rather than a guess.
export function studentForDoubt(students, byClass, chapterTag) {
  const list = students || [];
  if (list.length === 1) return list[0].id;
  if (list.length === 0 || chapterTag === UNTAGGED) return null;
  const matches = list.filter((s) => (byClass.get(s.class_id) || []).some((n) => key(n) === key(chapterTag)));
  return matches.length === 1 ? matches[0].id : null;
}
