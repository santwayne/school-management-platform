import pool from '../config/db.js';
import { getStudentDues } from '../utils/feeDues.js';

// Looks up students for the fee-intake review queue. A reviewer used to type a
// raw database id, which is how wrong students got paid; now the queue shows
// name + class + admission number + what is actually owed.
export async function searchStudents(schoolId, query, limit = 8) {
  const q = String(query || '').trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.login_id, s.admission_number, c.name AS class_name
     FROM students s
     LEFT JOIN classes c ON c.id = s.class_id
     WHERE s.school_id = $1
       AND (s.name ILIKE $2 OR s.login_id ILIKE $2 OR s.admission_number ILIKE $2)
     ORDER BY (LOWER(s.login_id) = LOWER($3) OR LOWER(s.admission_number) = LOWER($3)) DESC, s.name
     LIMIT $4`,
    [schoolId, like, q, limit]
  );
  return rows;
}

// Auto-match used when a slip arrives: only returns an id when the hint
// identifies exactly ONE student (exact login/admission number, or a single
// name match). Anything ambiguous stays unmatched for a human to pick.
export async function matchStudentFromHint(schoolId, hint) {
  const h = String(hint || '').trim();
  if (h.length < 2) return null;
  const exact = await pool.query(
    `SELECT id FROM students WHERE school_id = $1 AND (LOWER(login_id) = LOWER($2) OR LOWER(admission_number) = LOWER($2))`,
    [schoolId, h]
  );
  if (exact.rowCount === 1) return exact.rows[0].id;
  if (exact.rowCount > 1) return null;
  const byName = await searchStudents(schoolId, h, 2);
  const fullMatch = byName.filter((s) => s.name.toLowerCase() === h.toLowerCase());
  if (fullMatch.length === 1) return fullMatch[0].id;
  return byName.length === 1 ? byName[0].id : null;
}

export async function withDues(student) {
  if (!student) return null;
  const dues = await getStudentDues(student.id);
  return { ...student, fee_due: dues.configured ? dues.total : null, fee_configured: dues.configured };
}
