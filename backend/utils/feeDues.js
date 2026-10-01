import pool from '../config/db.js';
import { getCurrentAcademicYearStart, TUITION_ONLY_FILTER } from './academicYear.js';

// Single source of truth for "how much does this student owe right now".
//
// Bug this fixes: the WhatsApp parent assistant (fee balance / pay link) and
// the certificate service (fee certificate / leaving certificate gate) both
// read student_payment.amount_due — a column NO route has ever written (see
// the fee_structures comment in schema.sql). amount_due was always 0, so
// "due = amount_due - amount_paid" was always <= 0 and every student showed
// ₹0 dues: parents were told "no fees due", pay links were never created,
// and fee/leaving certificates were issued to students with real dues.
//
// Same formula the Fee Dashboard (routes/finance.js) and the fee-reminder
// worker already use, so all four places now agree:
//   tuition due = fee_structures.amount (student's class)
//                 - tuition paid THIS academic year (student_payment_history,
//                   transport rows excluded)
//   transport due = unpaid student_transport_fees rows
export async function getStudentDues(studentId, client = pool) {
  const academicYearStart = await getCurrentAcademicYearStart(client);
  const { rows } = await client.query(
    `SELECT
       fs.amount AS fee_amount,
       COALESCE((SELECT SUM(h.amount_paid) FROM student_payment_history h
                 WHERE h.student_id = s.id AND h.school_id = s.school_id
                   AND h.created_at >= $2 AND ${TUITION_ONLY_FILTER.replace(/remarks/g, 'h.remarks')}), 0) AS paid_this_year,
       COALESCE((SELECT SUM(t.monthly_fee) FROM student_transport_fees t
                 WHERE t.student_id = s.id AND t.collection_status <> 'collected'), 0) AS transport_due
     FROM students s
     LEFT JOIN fee_structures fs ON fs.school_id = s.school_id AND fs.class_id = s.class_id
     WHERE s.id = $1`,
    [studentId, academicYearStart]
  );
  return computeDues(rows[0]);
}

// Pure — exported for tests. `configured` is false when the student's class
// has no fee structure set up yet (so the bot can say "fee details not
// available" instead of a misleading "no dues").
export function computeDues(row) {
  if (!row) return { tuition: 0, transport: 0, total: 0, configured: false };
  const configured = row.fee_amount !== null && row.fee_amount !== undefined;
  const tuition = configured ? Math.max(0, Number(row.fee_amount) - Number(row.paid_this_year || 0)) : 0;
  const transport = Math.max(0, Number(row.transport_due || 0));
  return { tuition, transport, total: tuition + transport, configured };
}
