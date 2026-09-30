import pool from '../config/db.js';

// India's standard school year: April 1 - March 31. Hardcoded rather than
// configurable per school — no academic_year/term concept exists anywhere
// else in this schema yet (fee_structures' own comment in schema.sql
// anticipated needing one: "if per-term amounts are needed later, this
// table is the natural place to add a nullable term column"). This is the
// minimal fix for the real bug it caused: student_payment.amount_paid
// accumulates every payment a student has EVER made with no reset, so a
// family who paid in prior years shows a wildly inflated "paid" figure
// against fee_structures.amount, which is just this year's flat fee.
//
// Computed from the DB's IST clock, not the Node process's local time —
// mirrors parentAssistant.js's istToday(), since a Vercel serverless
// function's system clock is UTC, not IST, and the boundary must not shift
// by timezone.
export async function getCurrentAcademicYearStart(client = pool) {
  const { rows } = await client.query(
    `SELECT CASE WHEN EXTRACT(MONTH FROM ist)::int >= 4
                 THEN make_date(EXTRACT(YEAR FROM ist)::int, 4, 1)
                 ELSE make_date(EXTRACT(YEAR FROM ist)::int - 1, 4, 1)
            END AS start_date
     FROM (SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS ist) t`
  );
  return rows[0].start_date;
}

// student_payment_history has no itemized fee_type column (same schema.sql
// gap noted above) — a transport fee collection (transportPayoutService.js)
// is tagged only via this free-text remarks prefix, and lands in the exact
// same table/column a tuition payment does. Left un-excluded, transport
// collections inflate the tuition "paid" figure on top of the accumulation
// bug this file exists to fix. Matches the literal string
// transportPayoutService.js writes — keep in sync if that ever changes.
export const TUITION_ONLY_FILTER = `(remarks IS NULL OR remarks NOT LIKE 'Transport fee%')`;
