import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal, requireFinance } from '../middleware/auth.js';
import { getCurrentAcademicYearStart, TUITION_ONLY_FILTER } from '../utils/academicYear.js';

const router = express.Router();

// Record a fee payment (parameterized queries, wrapped in a transaction).
router.post('/fee/collect', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { student_id, amount_paid, payment_mode, remarks, proof_photo } = req.body;

  if (!student_id || !amount_paid || !payment_mode) {
    return res.status(400).json({ error: 'student_id, amount_paid and payment_mode are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // proof_photo is optional — small base64 images only for now (this is
    // stored directly in the DB; move to S3 if this needs to scale up).
    const paymentRes = await client.query(
      `INSERT INTO student_payment_history (school_id, student_id, amount_paid, payment_mode, remarks, proof_photo_url, collected_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [school_id, student_id, amount_paid, payment_mode, remarks || null, proof_photo || null, req.user.teacher_id || null]
    );

    await client.query(
      `INSERT INTO student_payment (school_id, student_id, amount_paid, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (student_id)
       DO UPDATE SET amount_paid = student_payment.amount_paid + EXCLUDED.amount_paid, updated_at = CURRENT_TIMESTAMP`,
      [school_id, student_id, amount_paid]
    );

    await client.query('COMMIT');
    res.status(200).json({ success: true, message: 'Fee recorded successfully.', paymentId: paymentRes.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Fee collect error:', err);
    res.status(500).json({ error: 'Failed to record payment' });
  } finally {
    client.release();
  }
});

// GET /api/finance/fee-structure — every class in this school with whatever
// expected fee amount is currently configured (null if never set). Backs the
// Fee Structure config screen (Item 5 of the QA fix list) — the fix for the
// Fee Dashboard's Expected/Unpaid always showing Rs 0, since nothing wrote
// amount_due before this existed.
router.get('/fee-structure', requireAuth, requireFinance, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id AS class_id, c.name AS class_name, fs.amount, fs.updated_at
       FROM classes c
       LEFT JOIN fee_structures fs ON fs.class_id = c.id AND fs.school_id = c.school_id
       WHERE c.school_id = $1
       ORDER BY c.name`,
      [req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Fee structure list error:', err);
    res.status(500).json({ error: 'Failed to load fee structure' });
  }
});

// PUT /api/finance/fee-structure/:classId — set (or update) the expected fee
// amount for one class. Upsert on (school_id, class_id).
router.put('/fee-structure/:classId', requireAuth, requireFinance, async (req, res) => {
  const { amount } = req.body;
  if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) < 0) {
    return res.status(400).json({ error: 'A non-negative amount is required' });
  }
  try {
    const classCheck = await pool.query(
      'SELECT id FROM classes WHERE id = $1 AND school_id = $2',
      [req.params.classId, req.user.school_id]
    );
    if (classCheck.rowCount === 0) return res.status(404).json({ error: 'Class not found for this school' });

    const { rows } = await pool.query(
      `INSERT INTO fee_structures (school_id, class_id, amount)
       VALUES ($1, $2, $3)
       ON CONFLICT (school_id, class_id) DO UPDATE SET amount = EXCLUDED.amount, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [req.user.school_id, req.params.classId, amount]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Fee structure update error:', err);
    res.status(500).json({ error: 'Failed to update fee structure' });
  }
});

// GET /api/finance/petty-cash — list requests for this school (most recent first)
router.get('/petty-cash', requireAuth, requireFinance, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM petty_cash WHERE school_id = $1 ORDER BY created_at DESC',
      [req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Petty cash list error:', err);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// GET /api/finance/students/search?q= — lets Accountant/Principal resolve a
// student to their internal numeric id by typing a name or the student's
// visible login ID (e.g. STD-2-KKSY). Accountants can't call
// GET /api/academics/students (principal-only), which was the underlying
// cause of the "student_id always null" fee-collection bug: with no way to
// look up the id, staff typed the login_id string into a numeric-id field,
// parseInt() on it returned NaN, and JSON serialized that as null.
router.get('/students/search', requireAuth, requireFinance, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.login_id, c.name AS class_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.school_id = $1 AND (s.name ILIKE $2 OR s.login_id ILIKE $2)
       ORDER BY s.name LIMIT 10`,
      [req.user.school_id, `%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error('Student search error:', err);
    res.status(500).json({ error: 'Failed to search students' });
  }
});

// GET /api/finance/staff/search?q= — same pattern as /students/search above,
// for Item 16's petty cash "Staff name" fix: lets the Accountant/Principal
// resolve a staff member to their real teacher id by typing a name, instead
// of hand-typing a name directly into petty_cash.requested_by (which is how
// a typo ended up saved with no link back to the actual staff record).
router.get('/staff/search', requireAuth, requireFinance, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, name, role FROM teachers WHERE school_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 10`,
      [req.user.school_id, `%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error('Staff search error:', err);
    res.status(500).json({ error: 'Failed to search staff' });
  }
});

// GET /api/finance/fee/history — recent fee payments for this school, for
// the Accountant / Principal fee collection screen.
router.get('/fee/history', requireAuth, requireFinance, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT h.id, h.student_id, s.name AS student_name, h.amount_paid, h.payment_mode,
              h.remarks, h.created_at
       FROM student_payment_history h
       JOIN students s ON s.id = h.student_id
       WHERE h.school_id = $1
       ORDER BY h.created_at DESC
       LIMIT 50`,
      [req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Fee history error:', err);
    res.status(500).json({ error: 'Failed to load fee history' });
  }
});

// GET /api/finance/fee/dashboard — everything the Fee Management Dashboard
// needs in one call: summary totals, collection/due-by-class, payment-mode
// split, and a paginated recent-transactions table. Computed live from
// student_payment / student_payment_history / students / classes — no mock
// data. Grouping uses classes.name (via students.class_id) rather than
// students.grade: grade is only ever populated by the super-admin demo seed
// route, so joining through classes is the only grouping that reflects real
// data for schools created through the normal admin flow.
router.get('/fee/dashboard', requireAuth, requireFinance, async (req, res) => {
  const school_id = req.user.school_id;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
  const offset = (page - 1) * pageSize;

  try {
    // total_expected is computed live from fee_structures (Item 5 of the QA
    // fix list) rather than read from student_payment.amount_due, which no
    // real route has ever written — see the fee_structures comment in
    // schema.sql. Computing live (student's class -> that class's configured
    // amount) means it's always correct even after a fee amount changes or a
    // student moves classes, with nothing to keep in sync.
    const summaryRes = await pool.query(
      `SELECT COALESCE(SUM(fs.amount), 0) AS total_expected
       FROM students s
       LEFT JOIN fee_structures fs ON fs.school_id = s.school_id AND fs.class_id = s.class_id
       WHERE s.school_id = $1`,
      [school_id]
    );

    // "Paid" used to be student_payment.amount_paid — a running total that
    // accumulates every payment a student has EVER made, with no reset. A
    // family who paid in prior years showed a hugely inflated total against
    // fee_structures.amount (a single flat CURRENT-year figure), e.g.
    // "Rs 1,600 expected, Rs 13,200 paid" for a student who'd simply paid
    // across several years. Fixed by summing only this academic year's rows
    // from student_payment_history instead (which already has real
    // per-payment timestamps — no schema migration needed), and excluding
    // transport-fee collections (tagged only via a remarks prefix, no real
    // fee_type column — see academicYear.js) since fee_structures.amount is
    // tuition-only.
    const academicYearStart = await getCurrentAcademicYearStart(pool);
    const totalPaidRes = await pool.query(
      `SELECT COALESCE(SUM(amount_paid), 0) AS total_paid
       FROM student_payment_history
       WHERE school_id = $1 AND created_at >= $2 AND ${TUITION_ONLY_FILTER}`,
      [school_id, academicYearStart]
    );
    const totalExpected = parseFloat(summaryRes.rows[0].total_expected);
    const totalPaid = parseFloat(totalPaidRes.rows[0].total_paid);
    // Expected is 0 for any class with no fee_structures amount configured
    // yet — clamp unpaid at 0 instead of showing a negative number in that case.
    const totalUnpaid = Math.max(totalExpected - totalPaid, 0);

    const collectedByClassRes = await pool.query(
      `SELECT COALESCE(c.name, 'Unassigned') AS class_name,
              COALESCE(SUM(h.amount_paid), 0) AS collected
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN student_payment_history h
         ON h.student_id = s.id AND h.school_id = s.school_id
         AND h.created_at >= $2 AND ${TUITION_ONLY_FILTER}
       WHERE s.school_id = $1
       GROUP BY c.name
       ORDER BY c.name NULLS LAST`,
      [school_id, academicYearStart]
    );

    // fee_structures (>=0-to-1 row per student) and student_payment_history
    // (0-to-many rows per student) can't both be joined directly onto
    // `students` in one GROUP BY — a student with 2 payments this year would
    // fan out to 2 rows and double-count their fs.amount. Pre-aggregate paid
    // per student first, THEN join 1:1, so each student contributes exactly
    // one row before the class-level SUM.
    const dueByClassRes = await pool.query(
      `WITH paid_this_year AS (
         SELECT student_id, SUM(amount_paid) AS paid
         FROM student_payment_history
         WHERE school_id = $1 AND created_at >= $2 AND ${TUITION_ONLY_FILTER}
         GROUP BY student_id
       )
       SELECT COALESCE(c.name, 'Unassigned') AS class_name,
              GREATEST(COALESCE(SUM(fs.amount), 0) - COALESCE(SUM(pty.paid), 0), 0) AS unpaid
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN fee_structures fs ON fs.school_id = s.school_id AND fs.class_id = s.class_id
       LEFT JOIN paid_this_year pty ON pty.student_id = s.id
       WHERE s.school_id = $1
       GROUP BY c.name
       ORDER BY c.name NULLS LAST`,
      [school_id, academicYearStart]
    );

    const byModeRes = await pool.query(
      `SELECT COALESCE(payment_mode, 'Unknown') AS payment_mode,
              COALESCE(SUM(amount_paid), 0) AS amount,
              COUNT(*) AS txn_count
       FROM student_payment_history
       WHERE school_id = $1
       GROUP BY payment_mode
       ORDER BY amount DESC`,
      [school_id]
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM student_payment_history WHERE school_id = $1`,
      [school_id]
    );
    const total = parseInt(countRes.rows[0].count, 10);

    // No students.admission_number column exists yet — fall back to the
    // internal numeric student id (another branch may add admission_number;
    // this call is written so it's a one-line swap once it lands).
    const recentRes = await pool.query(
      `SELECT h.id, h.student_id, s.name AS student_name, h.amount_paid, h.payment_mode,
              h.created_at, COALESCE(c.name, 'Unassigned') AS class_name
       FROM student_payment_history h
       JOIN students s ON s.id = h.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE h.school_id = $1
       ORDER BY h.created_at DESC
       LIMIT $2 OFFSET $3`,
      [school_id, pageSize, offset]
    );

    res.json({
      summary: {
        total_expected: totalExpected,
        total_paid: totalPaid,
        total_unpaid: totalUnpaid,
      },
      collected_by_class: collectedByClassRes.rows.map((r) => ({ class_name: r.class_name, collected: parseFloat(r.collected) })),
      due_by_class: dueByClassRes.rows.map((r) => ({ class_name: r.class_name, unpaid: parseFloat(r.unpaid) })),
      by_payment_mode: byModeRes.rows.map((r) => ({
        payment_mode: r.payment_mode,
        amount: parseFloat(r.amount),
        txn_count: parseInt(r.txn_count, 10),
      })),
      recent_transactions: {
        rows: recentRes.rows,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (err) {
    console.error('Fee dashboard error:', err);
    res.status(500).json({ error: 'Failed to load fee dashboard' });
  }
});

// Item 16: staff_id is now required instead of a hand-typed requested_by
// string — resolved server-side to the real teacher record (never trust a
// client-supplied name) so the "sant" typo class of bug can't recur.
// requested_by (text) is still written, from the resolved name, purely so
// every existing reader of that column (GET /petty-cash, exports, ...) keeps
// working unchanged.
router.post('/petty-cash/request', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { staff_id, amount, purpose } = req.body;

  if (!staff_id || !amount) {
    return res.status(400).json({ error: 'staff_id and amount are required' });
  }

  try {
    const staffRes = await pool.query(
      'SELECT id, name FROM teachers WHERE id = $1 AND school_id = $2',
      [staff_id, school_id]
    );
    if (staffRes.rowCount === 0) {
      return res.status(404).json({ error: 'Staff member not found for this school' });
    }
    const staff = staffRes.rows[0];

    const result = await pool.query(
      `INSERT INTO petty_cash (school_id, requested_by, requested_by_teacher_id, amount, purpose, status)
       VALUES ($1, $2, $3, $4, $5, 'PENDING') RETURNING id`,
      [school_id, staff.name, staff.id, amount, purpose || null]
    );
    res.status(200).json({ success: true, message: 'Expense request raised.', requestId: result.rows[0].id });
  } catch (err) {
    console.error('Petty cash request error:', err);
    res.status(500).json({ error: 'Failed to raise request' });
  }
});

// Lets Accountant/Principal correct the amount/purpose while a request is
// still PENDING — needed for WhatsApp-photo-intake requests (routes/whatsapp.js)
// where the AI extraction can misread a receipt (or the amount comes through
// as 0 when nothing was legible at all).
router.patch('/petty-cash/:id', requireAuth, requireFinance, async (req, res) => {
  const { amount, purpose } = req.body;
  try {
    const result = await pool.query(
      `UPDATE petty_cash SET amount = COALESCE($1, amount), purpose = COALESCE($2, purpose)
       WHERE id = $3 AND school_id = $4 AND status = 'PENDING' RETURNING *`,
      [amount, purpose, req.params.id, req.user.school_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Pending request not found for this school' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Petty cash edit error:', err);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// Principal or Accountant can approve/reject petty cash, enforced
// server-side. An accountant can only approve requests at or under the
// school's configured limit (school_settings.petty_cash_accountant_limit,
// default ₹5,000) — anything above that must go to the principal.
router.patch('/petty-cash/approve/:id', requireAuth, requireFinance, async (req, res) => {
  const school_id = req.user.school_id;
  const { id } = req.params;
  const { status } = req.body; // 'APPROVED' | 'REJECTED'

  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: "status must be 'APPROVED' or 'REJECTED'" });
  }

  try {
    if (req.user.role === 'accountant' && status === 'APPROVED') {
      const requestRes = await pool.query(
        'SELECT amount FROM petty_cash WHERE id = $1 AND school_id = $2',
        [id, school_id]
      );
      if (requestRes.rowCount === 0) {
        return res.status(404).json({ error: 'Request not found for this school' });
      }
      const settingsRes = await pool.query(
        'SELECT petty_cash_accountant_limit FROM school_settings WHERE school_id = $1',
        [school_id]
      );
      const limit = settingsRes.rowCount > 0 ? parseFloat(settingsRes.rows[0].petty_cash_accountant_limit) : 5000;
      if (parseFloat(requestRes.rows[0].amount) > limit) {
        return res.status(403).json({
          error: `This request is above your approval limit (Rs ${limit}). It needs Principal approval.`,
        });
      }
    }

    const result = await pool.query(
      `UPDATE petty_cash
       SET status = $1, approved_by = $2, actioned_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND school_id = $4
       RETURNING id`,
      [status, req.user.teacher_id, id, school_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Request not found for this school' });
    }

    await pool.query(
      `INSERT INTO petty_cash_history (petty_cash_id, action, actioned_by) VALUES ($1, $2, $3)`,
      [id, status, req.user.teacher_id]
    );

    res.status(200).json({ success: true, message: `Request status updated to ${status}` });
  } catch (err) {
    console.error('Petty cash approval error:', err);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

export default router;
