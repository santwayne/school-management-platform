import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireStudent } from '../middleware/auth.js';
import { send as sendNotification } from '../services/notificationService.js';

const router = express.Router();

function requireTeacherOrPrincipal(req, res, next) {
  if (!req.user || !['teacher', 'principal'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Teacher or Principal role required' });
  }
  next();
}

// Principal can review any request in their school. A teacher can only
// review requests for a class where they are the designated class incharge
// (classes.class_teacher_id, added in feature/student-teacher-profiles) —
// NOT any teacher who happens to teach a subject in that class. Confirmed
// scope: only the class incharge approves student leave, per Pankaj.
async function canReviewClass(req, classId) {
  if (req.user.role === 'principal') return true;
  if (!classId) return false;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM classes WHERE id = $1 AND school_id = $2 AND class_teacher_id = $3`,
    [classId, req.user.school_id, req.user.teacher_id]
  );
  return rowCount > 0;
}

// POST /api/student-leave/requests — student applies for leave
router.post('/requests', requireAuth, requireStudent, async (req, res) => {
  const { reason, from_date, to_date } = req.body;
  if (!from_date || !to_date) {
    return res.status(400).json({ error: 'from_date and to_date are required' });
  }
  if (new Date(to_date) < new Date(from_date)) {
    return res.status(400).json({ error: 'to_date cannot be before from_date' });
  }

  try {
    const studentRes = await pool.query(
      'SELECT class_id, name FROM students WHERE id = $1 AND school_id = $2',
      [req.user.student_id, req.user.school_id]
    );
    if (studentRes.rowCount === 0) return res.status(404).json({ error: 'Student not found' });

    const { rows } = await pool.query(
      `INSERT INTO student_leave_requests (school_id, student_id, class_id, from_date, to_date, reason)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.school_id, req.user.student_id, studentRes.rows[0].class_id, from_date, to_date, reason || null]
    );

    // Notify whoever can actually approve this: the class incharge if one is
    // assigned, otherwise the principal (a class with no incharge yet would
    // otherwise have nobody notified at all).
    try {
      const classId = studentRes.rows[0].class_id;
      let reviewerTeacherIds = [];
      if (classId) {
        const inchargeRes = await pool.query('SELECT class_teacher_id FROM classes WHERE id = $1', [classId]);
        if (inchargeRes.rows[0]?.class_teacher_id) reviewerTeacherIds = [inchargeRes.rows[0].class_teacher_id];
      }
      if (reviewerTeacherIds.length === 0) {
        const principals = await pool.query(`SELECT id FROM teachers WHERE school_id = $1 AND role = 'principal'`, [req.user.school_id]);
        reviewerTeacherIds = principals.rows.map((p) => p.id);
      }
      if (reviewerTeacherIds.length > 0) {
        await sendNotification({
          triggerEvent: 'student_leave_submitted',
          schoolId: req.user.school_id,
          recipients: reviewerTeacherIds.map((id) => ({ type: 'staff', teacherId: id })),
          variables: { student_name: studentRes.rows[0].name, from_date, to_date },
          link: '/student-leave',
        });
      }
    } catch (notifyErr) {
      console.error('student_leave_submitted notification failed:', notifyErr.message);
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/student-leave/requests — student sees only their own; teacher sees
// requests only from classes where they're the class incharge; principal
// sees every request in the school.
router.get('/requests', requireAuth, async (req, res) => {
  const { status } = req.query;
  const params = [req.user.school_id];
  let where = 'lr.school_id = $1';

  if (req.user.role === 'student') {
    params.push(req.user.student_id);
    where += ` AND lr.student_id = $${params.length}`;
  } else if (req.user.role === 'teacher') {
    params.push(req.user.teacher_id);
    where += ` AND lr.class_id IN (SELECT id FROM classes WHERE class_teacher_id = $${params.length} AND school_id = $1)`;
  } else if (req.user.role !== 'principal') {
    return res.status(403).json({ error: 'Not authorized to view student leave requests' });
  }

  if (status) {
    params.push(status.toUpperCase());
    where += ` AND lr.status = $${params.length}`;
  }

  try {
    const { rows } = await pool.query(
      `SELECT lr.*, s.name AS student_name, s.admission_number, c.name AS class_name, c.section
       FROM student_leave_requests lr
       JOIN students s ON s.id = lr.student_id
       LEFT JOIN classes c ON c.id = lr.class_id
       WHERE ${where}
       ORDER BY lr.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/student-leave/requests/:id — principal OR the student's class
// teacher approves/declines, with an optional remark.
router.put('/requests/:id', requireAuth, requireTeacherOrPrincipal, async (req, res) => {
  const { id } = req.params;
  const { status, review_note } = req.body;
  if (!['APPROVED', 'DECLINED'].includes(status)) {
    return res.status(400).json({ error: 'status must be APPROVED or DECLINED' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: reqRows } = await client.query(
      'SELECT * FROM student_leave_requests WHERE id = $1 AND school_id = $2 FOR UPDATE',
      [id, req.user.school_id]
    );
    if (reqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Leave request not found' });
    }
    const leaveReq = reqRows[0];

    if (!(await canReviewClass(req, leaveReq.class_id))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the class incharge or principal can review this request' });
    }

    if (leaveReq.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Request already ${leaveReq.status.toLowerCase()}` });
    }

    const { rows: updated } = await client.query(
      `UPDATE student_leave_requests
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3
       WHERE id = $4 RETURNING *`,
      [status, req.user.teacher_id, review_note || null, id]
    );

    await client.query('COMMIT');

    sendNotification({
      triggerEvent: 'student_leave_status_changed',
      schoolId: req.user.school_id,
      recipients: [{ type: 'student', studentId: leaveReq.student_id }],
      variables: { status: status.toLowerCase(), review_note: review_note || '' },
      link: '/student/leave',
    }).catch((notifyErr) => console.error('student_leave_status_changed notification failed:', notifyErr.message));

    res.json(updated[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
