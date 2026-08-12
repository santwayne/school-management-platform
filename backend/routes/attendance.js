import express from 'express';
import pool from '../config/db.js';
import { attendanceQueue, ESCALATION_DELAY_MS } from '../config/queue.js';
import { requireAuth } from '../middleware/auth.js';
import { sendTemplateMessage } from '../services/whatsappService.js';

const router = express.Router();

// Meta requires an approved template for the first outbound message in a
// conversation window — must match a template approved in WhatsApp Business
// Manager for this number. Kept in sync with workers/attendanceWorker.js.
const ABSENCE_TEMPLATE_NAME = process.env.WHATSAPP_ABSENCE_TEMPLATE || 'student_absence_alert';

// Sends the absence WhatsApp message right now and logs the outcome.
// Previously this was queued (attendanceQueue.add('sendAbsentNotification', ...))
// for workers/attendanceWorker.js to pick up — but that worker only runs if
// something keeps a persistent Node process alive to host the BullMQ Worker
// listener. Vercel serverless functions don't: each request is a fresh,
// short-lived invocation, so queued jobs sat in Redis and were never
// processed. Sending inline here means the API response itself reflects
// whether the message actually went out.
async function sendAbsentNotificationNow({ attendanceId, parent, studentId }) {
  let status = 'SENT';
  try {
    await sendTemplateMessage(
      parent.phone,
      ABSENCE_TEMPLATE_NAME,
      'en_US',
      [parent.student_name]
    );
  } catch (err) {
    console.error(`WhatsApp send failed for attendance ${attendanceId}:`, err.message);
    status = 'FAILED';
  }

  const logRes = await pool.query(
    `INSERT INTO notification_log (attendance_id, parent_id, type, status)
     VALUES ($1, $2, 'whatsapp', $3) RETURNING id`,
    [attendanceId, parent.id, status]
  );
  const notificationLogId = logRes.rows[0].id;

  // The voice-call escalation genuinely has to wait (parents get
  // ESCALATION_DELAY_MS to reply before we call) — that can't happen inside
  // this request, so it still goes on the queue. NOTE: this still depends on
  // workers/attendanceWorker.js actually running somewhere, which has the
  // exact same problem this function was written to fix for the immediate
  // send — see the deployment note in the PR/chat before assuming escalation
  // calls are firing in production.
  await attendanceQueue.add(
    'escalateToVoiceCall',
    {
      attendanceId,
      parentId: parent.id,
      parentPhone: parent.phone,
      parentLanguage: parent.preferred_language,
      studentName: parent.student_name,
      notificationLogId,
    },
    { delay: ESCALATION_DELAY_MS }
  );

  return { student_id: studentId, whatsapp_status: status, notification_log_id: notificationLogId };
}

// Mark attendance & send the WhatsApp -> (delayed) voice-call escalation
// flow for any student marked absent whose parent is OPTED_IN.
router.post('/mark', requireAuth, async (req, res) => {
  const school_id = req.user.school_id; // trust the token, not the body
  const { records } = req.body; // [{ student_id, status }]

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array is required' });
  }

  const client = await pool.connect();
  let toNotify = [];
  try {
    await client.query('BEGIN');

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
          toNotify.push({ attendanceId, parent, studentId: record.student_id });
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Attendance mark error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }

  // Sent after COMMIT, outside the DB transaction/connection: attendance is
  // marked either way, and a slow or failed WhatsApp send must never roll
  // back attendance that was already successfully recorded. Sent in
  // parallel rather than one-by-one so marking a full class's absences
  // doesn't serialize N sequential WhatsApp API calls into one slow request.
  const notifications = await Promise.all(toNotify.map(sendAbsentNotificationNow));

  res.status(200).json({ success: true, message: 'Attendance processed.', notifications });
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
