import pool from '../config/db.js';

// Generic event-driven notification hook — insert-only, no delivery
// mechanism of its own. Any feature (leave approval, cert requests, fee due
// reminders, a new message thread, …) calls notify() once its own write has
// succeeded, and the recipient picks it up next time they hit
// GET /api/notifications (the bell in AdminShell polls this on an interval,
// same as it already did for the two hardcoded queries it replaces).
//
// recipientRole/recipientId are expected to line up with req.user's shape:
// role plus whichever of teacher_id / student_id applies to that role, so
// callers can pass req.user.role and req.user.teacher_id (or student_id)
// straight through without a lookup.
export async function notify({ schoolId, recipientRole, recipientId, eventType, message, link }) {
  if (!schoolId || !recipientRole || !recipientId || !eventType || !message) {
    throw new Error('notify() requires schoolId, recipientRole, recipientId, eventType and message');
  }

  const { rows } = await pool.query(
    `INSERT INTO notifications (school_id, recipient_role, recipient_id, event_type, message, link)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [schoolId, recipientRole, recipientId, eventType, message, link || null]
  );
  return rows[0];
}
