import pool from '../config/db.js';
import { send as sendNotification } from './notificationService.js';

// One-time share of a lesson plan (and its attachment) with every student in
// the class. "UPDATE ... WHERE shared_at IS NULL" is the latch: only the first
// call gets a row back, so the class is never notified twice. The plan's own
// teacher or the principal may share it.
// Returns { status, body } so the HTTP route and the WhatsApp command can both
// use it; the fan-out runs in the background and never throws.
export async function shareLessonPlan(user, rawId) {
  const schoolId = user.school_id;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return { status: 404, body: { error: 'Lesson plan not found' } };
  const isPrincipal = user.role === 'principal';

  const claimed = await pool.query(
    `UPDATE lesson_plans lp SET shared_at = CURRENT_TIMESTAMP
      WHERE lp.id = $1 AND lp.school_id = $2 AND lp.shared_at IS NULL AND ($3::boolean OR lp.teacher_id = $4)
      RETURNING lp.id, lp.class_id, lp.subject_id, lp.title, lp.content, lp.attachment_url`,
    [id, schoolId, isPrincipal, user.teacher_id]
  );
  if (claimed.rowCount === 0) {
    const exists = await pool.query(
      'SELECT 1 FROM lesson_plans WHERE id = $1 AND school_id = $2 AND ($3::boolean OR teacher_id = $4)',
      [id, schoolId, isPrincipal, user.teacher_id]
    );
    if (exists.rowCount === 0) return { status: 404, body: { error: 'Lesson plan not found' } };
    return { status: 409, body: { error: 'This lesson plan has already been shared with the class.' } };
  }
  const plan = claimed.rows[0];
  fanOut(plan, schoolId);
  return { status: 200, body: { shared: true } };
}

async function fanOut(plan, schoolId) {
  try {
    const [students, subject] = await Promise.all([
      pool.query('SELECT id FROM students WHERE class_id = $1 AND school_id = $2 ORDER BY id', [plan.class_id, schoolId]),
      plan.subject_id ? pool.query('SELECT name FROM subjects WHERE id = $1', [plan.subject_id]) : { rows: [] },
    ]);
    await sendNotification({
      triggerEvent: 'lesson_plan_shared',
      schoolId,
      recipients: students.rows.flatMap((s) => [{ type: 'student', studentId: s.id }, { type: 'parent', studentId: s.id }]),
      batchKey: `lesson_plan:${plan.id}`,
      attachments: plan.attachment_url ? [{ url: plan.attachment_url, type: 'document' }] : [],
      variables: {
        title: plan.title,
        subject: subject.rows[0]?.name || 'General',
        description: String(plan.content || '').replace(/\s+/g, ' ').slice(0, 200),
      },
    });
  } catch (err) {
    console.error(`lesson_plan_shared fan-out failed for plan ${plan.id}:`, err.message);
  }
}
