import express from 'express';
import pool from '../config/db.js';
import { attendanceQueue } from '../config/queue.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Mark attendance & trigger the WhatsApp -> (delayed) voice-call escalation
// flow for any student marked absent whose parent is OPTED_IN.
router.post('/mark', requireAuth, async (req, res) => {
  const school_id = req.user.school_id; // trust the token, not the body
  const { records } = req.body; // [{ student_id, status }]

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const queuedNotifications = [];

    for (const record of records) {
      const attRes = await client.query(
        `INSERT INTO attendance (school_id, student_id, status, marked_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_id, date) DO UPDATE SET status = EXCLUDED.status
         RETURNING id`,
        [school_id, record.student_id, record.status, req.user.teacher_id]
      );
      const attendanceId = attRes.rows[0].id;

      if (record.status === 'absent') {
        const parentRes = await client.query(
          `SELECT p.id, p.name AS parent_name, p.phone, p.opt_in_status, p.preferred_language, s.name AS student_name
           FROM students s
           JOIN parents p ON s.parent_id = p.id
           WHERE s.id = $1 AND s.school_id = $2`,
          [record.student_id, school_id]
        );
        const parent = parentRes.rows[0];

        // STRICT COMPLIANCE GATE — only ever contact OPTED_IN parents,
        // enforced here at the query/insert level, not just in the UI.
        if (parent && parent.opt_in_status === 'OPTED_IN') {
          const job = await attendanceQueue.add(
            'sendAbsentNotification',
            {
              attendanceId,
              parentId: parent.id,
              parentPhone: parent.phone,
              parentLanguage: parent.preferred_language,
              studentId: record.student_id,
              studentName: parent.student_name,
            },
            { delay: 0 }
          );
          queuedNotifications.push({ student_id: record.student_id, job_id: job.id });
        }
      }
    }

    await client.query('COMMIT');
    res.status(200).json({ success: true, message: 'Attendance processed.', queuedNotifications });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Attendance mark error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

router.get('/today/:classId', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  const { classId } = req.params;
  try {
    const result = await pool.query(
      `SELECT s.id AS student_id, s.name, a.status
       FROM students s
       LEFT JOIN attendance a ON a.student_id = s.id AND a.date = CURRENT_DATE
       WHERE s.class_id = $1 AND s.school_id = $2
       ORDER BY s.name`,
      [classId, school_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Fetch today attendance error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
