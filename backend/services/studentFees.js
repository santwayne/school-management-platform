import pool from '../config/db.js';
import { getCurrentAcademicYearStart, TUITION_ONLY_FILTER } from '../utils/academicYear.js';

// One student's fee structure with paid / unpaid status for the current
// academic year (April-March). Uses the same formula as the Fee Dashboard and
// getStudentDues (utils/feeDues.js): tuition = the class's fee_structures
// amount minus tuition paid this year; transport = per-month rows.
export function feeStatus({ configured, due }) {
  if (!configured) return 'not_configured';
  if (due <= 0) return 'paid';
  return 'unpaid';
}

export async function getStudentFeeSummary(schoolId, studentId) {
  const yearStart = await getCurrentAcademicYearStart();
  const filter = TUITION_ONLY_FILTER.replace(/remarks/g, 'h.remarks');

  const base = await pool.query(
    `SELECT s.id, c.name AS class_name, fs.amount AS structure_amount,
            COALESCE((SELECT SUM(h.amount_paid) FROM student_payment_history h
                       WHERE h.student_id = s.id AND h.school_id = s.school_id
                         AND h.created_at >= $3 AND ${filter}), 0) AS paid
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN fee_structures fs ON fs.school_id = s.school_id AND fs.class_id = s.class_id
      WHERE s.id = $1 AND s.school_id = $2`,
    [studentId, schoolId, yearStart]
  );
  if (!base.rowCount) return null;
  const row = base.rows[0];

  const [payments, transport] = await Promise.all([
    pool.query(
      `SELECT id, amount_paid, payment_mode, remarks, created_at
         FROM student_payment_history
        WHERE student_id = $1 AND school_id = $2 AND created_at >= $3
        ORDER BY created_at DESC LIMIT 50`,
      [studentId, schoolId, yearStart]
    ),
    pool.query(
      `SELECT billing_month, monthly_fee, collection_status, pickup_point
         FROM student_transport_fees WHERE student_id = $1 AND school_id = $2
        ORDER BY billing_month DESC LIMIT 24`,
      [studentId, schoolId]
    ),
  ]);

  const configured = row.structure_amount !== null;
  const structure = configured ? Number(row.structure_amount) : 0;
  const paid = Number(row.paid);
  const due = configured ? Math.max(0, structure - paid) : 0;
  const transportRows = transport.rows.map((t) => ({ ...t, monthly_fee: Number(t.monthly_fee) }));
  const transportDue = transportRows.filter((t) => t.collection_status !== 'collected').reduce((a, t) => a + t.monthly_fee, 0);

  return {
    class_name: row.class_name,
    academic_year_start: yearStart,
    tuition: { configured, structure_amount: structure, paid, due, status: feeStatus({ configured, due }) },
    transport: { rows: transportRows, due: transportDue },
    total_due: due + transportDue,
    payments: payments.rows.map((p) => ({ ...p, amount_paid: Number(p.amount_paid) })),
  };
}
