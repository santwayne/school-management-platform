// One label for a class everywhere it is shown to a person.
//
// classes.name is free text and schools write it both ways: "Class 6" with
// section "A", or "Class 6A" with section "A". Blindly joining the two gave
// "Class 6A A" in substitution notices. So the section is only appended when
// the name does not already end with it.

// SQL expression — expects the classes table aliased as `c`.
export const CLASS_LABEL_SQL = `(CASE
    WHEN c.section IS NULL OR btrim(c.section) = '' THEN c.name
    WHEN right(lower(btrim(c.name)), length(btrim(c.section))) = lower(btrim(c.section)) THEN c.name
    ELSE c.name || ' ' || btrim(c.section)
  END)`;

// Same rule in JS (kept in step with the SQL above; unit-tested).
export function classLabel(name, section) {
  const n = String(name ?? '').trim();
  const s = String(section ?? '').trim();
  if (!s) return n;
  return n.toLowerCase().endsWith(s.toLowerCase()) ? n : `${n} ${s}`;
}
