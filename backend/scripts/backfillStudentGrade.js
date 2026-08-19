import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

// Item 12 of the QA fix list — one-off cleanup for existing bad data.
//
// grade is free text on the student row, never FK'd to class_id (see
// schema.sql). The Student Strength report used to GROUP BY that free-text
// column alongside the real class, so any student whose grade value didn't
// exactly match their classmates' (a typo, "Class 8" vs "8", blank, ...)
// spawned a phantom row for the same real class — that query bug is fixed
// separately in routes/studentRecords.js. This script is the OTHER half:
// cleaning up the underlying bad grade values already sitting in the
// database, for anything that still reads students.grade directly (grade
// filters, exports, etc.) elsewhere in the app.
//
// Heuristic: pull the first number out of both the student's class name
// (e.g. "Class 8A" -> "8") and their current grade value, and flag a
// mismatch whenever they don't agree (including when grade is blank but
// the class name does have a number). A class name with NO number in it
// (e.g. "Nursery", "LKG") is skipped entirely — there's nothing numeric to
// derive a grade from, so guessing would risk overwriting genuinely correct
// free-text data with something wrong.
//
// SAFE BY DEFAULT: running this script with no flags only PRINTS what it
// would change — it does not touch the database. Pass --apply to actually
// write the backfill (wrapped in a transaction, rolled back on any error).
//
//   node scripts/backfillStudentGrade.js            # dry run (default)
//   node scripts/backfillStudentGrade.js --apply     # actually backfill
//
// Review the dry-run output against real production data before ever
// passing --apply — this was written but deliberately NOT run automatically
// as part of the QA fix, per the instruction to leave that call to a human.

function extractNumber(text) {
  if (!text) return null;
  const match = String(text).match(/\d+/);
  return match ? match[0] : null;
}

async function run() {
  const apply = process.argv.includes('--apply');

  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.school_id, s.grade AS current_grade, c.name AS class_name
     FROM students s
     JOIN classes c ON c.id = s.class_id
     ORDER BY s.school_id, c.name, s.name`
  );

  const mismatches = [];
  for (const row of rows) {
    const derivedGrade = extractNumber(row.class_name);
    if (!derivedGrade) continue; // class name has no number to derive from — skip, don't guess

    const currentGrade = (row.current_grade || '').trim();
    const currentNumber = extractNumber(currentGrade);
    if (currentNumber === derivedGrade) continue; // already agrees — nothing to do

    mismatches.push({ ...row, derivedGrade });
  }

  if (mismatches.length === 0) {
    console.log('No grade/class mismatches found. Nothing to do.');
    await pool.end();
    return;
  }

  console.log(`Found ${mismatches.length} student(s) whose grade disagrees with their class:\n`);
  console.log('school_id | student_id | name                 | class_name      | current_grade   -> derived_grade');
  console.log('-'.repeat(100));
  for (const m of mismatches) {
    console.log(
      `${String(m.school_id).padEnd(9)} | ${String(m.id).padEnd(10)} | ${m.name.slice(0, 20).padEnd(20)} | ${m.class_name.slice(0, 15).padEnd(15)} | ${(m.current_grade || '(blank)').slice(0, 15).padEnd(15)} -> ${m.derivedGrade}`
    );
  }

  if (!apply) {
    console.log(`\nDry run only — no changes written. Re-run with --apply to backfill these ${mismatches.length} row(s).`);
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const m of mismatches) {
      await client.query('UPDATE students SET grade = $1 WHERE id = $2', [m.derivedGrade, m.id]);
    }
    await client.query('COMMIT');
    console.log(`\nBackfilled grade for ${mismatches.length} student(s).`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Backfill failed, rolled back:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
