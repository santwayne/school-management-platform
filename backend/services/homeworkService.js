import pool from '../config/db.js';
import { send as sendNotification } from './notificationService.js';
import { formatNotifyDate } from '../utils/notifyDate.js';
import { isOwnMediaUrl } from './teachingMedia.js';

// ------------------------------------------------------------------
// Homework: a teacher (or the principal) assigns it to a class; every
// student in the class sees it in the Student Portal and each opted-in
// parent gets the approved "homework_assigned_alert" WhatsApp template.
//
// homework.subject_id holds the subject NAME (the Student Portal and the
// WhatsApp parent assistant print that column as-is); subject_ref_id is
// the real subjects.id. See the note in schema.sql.
// ------------------------------------------------------------------

export class HomeworkError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TITLE_MAX = 255;
const DESCRIPTION_MAX = 2000;
// A double-tap on "Assign" must not message every parent twice.
const DUPLICATE_WINDOW_MINUTES = 2;

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// 'YYYY-MM-DD' that is a real calendar day (rejects 2026-02-31).
export function isRealDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

// Pure: checks and tidies what the form sent. `today` is the school's
// calendar day as 'YYYY-MM-DD'. Throws HomeworkError(400) with a message a
// teacher can act on.
export function validateHomeworkInput(body, { today, schoolId }) {
  const classId = positiveInt(body?.class_id);
  const subjectId = positiveInt(body?.subject_id);
  if (!classId) throw new HomeworkError(400, 'Choose a class.');
  if (!subjectId) throw new HomeworkError(400, 'Choose a subject.');

  // WhatsApp template variables may not contain new lines or tabs, and the
  // title is one of them, so it is kept on a single line.
  const title = String(body?.title ?? '').replace(/\s+/g, ' ').trim();
  if (!title) throw new HomeworkError(400, 'Write a title for the homework.');
  if (title.length > TITLE_MAX) throw new HomeworkError(400, `Keep the title under ${TITLE_MAX} characters.`);

  const description = String(body?.description ?? '').trim();
  if (description.length > DESCRIPTION_MAX) throw new HomeworkError(400, `Keep the details under ${DESCRIPTION_MAX} characters.`);

  let dueDate = null;
  if (body?.due_date) {
    if (!isRealDate(body.due_date)) throw new HomeworkError(400, 'The due date is not a valid date.');
    if (today && body.due_date < today) throw new HomeworkError(400, 'The due date cannot be in the past.');
    dueDate = body.due_date;
  }

  // Attachment comes from POST /api/teaching-media/upload; only our own
  // bucket's URLs are accepted.
  const attachmentUrl = body?.attachment_url ? String(body.attachment_url) : null;
  if (attachmentUrl && !isOwnMediaUrl(attachmentUrl, schoolId)) throw new HomeworkError(400, 'Attach the file using the upload button.');
  const attachmentName = attachmentUrl ? String(body?.attachment_name || 'attachment').slice(0, 255) : null;

  return { classId, subjectId, title, description: description || null, dueDate, attachmentUrl, attachmentName };
}

async function schoolToday() {
  // Every pooled connection is pinned to Asia/Kolkata (config/db.js).
  const r = await pool.query(`SELECT CURRENT_DATE::text AS today`);
  return r.rows[0].today;
}

// Which class + subject pairs this login may assign homework for.
// A teacher: only what they teach. The principal: every pair that has a
// teacher assigned.
export async function homeworkOptions(user) {
  const isPrincipal = user.role === 'principal';
  const { rows } = await pool.query(
    `SELECT DISTINCT cst.class_id, c.name AS class_name, cst.subject_id, s.name AS subject_name
       FROM class_subject_teachers cst
       JOIN classes c ON c.id = cst.class_id
       JOIN subjects s ON s.id = cst.subject_id
      WHERE cst.school_id = $1 AND ($2::boolean OR cst.teacher_id = $3)
      ORDER BY c.name, s.name`,
    [user.school_id, isPrincipal, user.teacher_id]
  );
  return rows;
}

export async function createHomework(user, body) {
  if (!user || !['teacher', 'principal'].includes(user.role) || !user.teacher_id) {
    throw new HomeworkError(403, 'Teacher or Principal role required');
  }
  const schoolId = user.school_id;
  const input = validateHomeworkInput(body, { today: await schoolToday(), schoolId });

  const cls = await pool.query('SELECT id, name FROM classes WHERE id = $1 AND school_id = $2', [input.classId, schoolId]);
  if (!cls.rowCount) throw new HomeworkError(404, 'Class not found for this school');
  const subject = await pool.query('SELECT id, name FROM subjects WHERE id = $1 AND school_id = $2', [input.subjectId, schoolId]);
  if (!subject.rowCount) throw new HomeworkError(404, 'Subject not found for this school');

  if (user.role !== 'principal') {
    const assigned = await pool.query(
      'SELECT 1 FROM class_subject_teachers WHERE class_id = $1 AND subject_id = $2 AND teacher_id = $3 AND school_id = $4',
      [input.classId, input.subjectId, user.teacher_id, schoolId]
    );
    if (!assigned.rowCount) throw new HomeworkError(403, 'You are not assigned to this class and subject.');
  }

  const dup = await pool.query(
    `SELECT id FROM homework
      WHERE school_id = $1 AND class_id = $2 AND subject_ref_id = $3 AND created_by = $4
        AND LOWER(title) = LOWER($5)
        AND created_at > CURRENT_TIMESTAMP - ($6 || ' minutes')::interval
      LIMIT 1`,
    [schoolId, input.classId, input.subjectId, user.teacher_id, input.title, DUPLICATE_WINDOW_MINUTES]
  );
  if (dup.rowCount) throw new HomeworkError(409, 'This homework was just assigned. Refresh the list to see it.');

  const subjectName = subject.rows[0].name;
  const { rows } = await pool.query(
    `INSERT INTO homework (school_id, class_id, subject_id, subject_ref_id, title, description, due_date, created_by, attachment_url, attachment_name, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, school_id, class_id, subject_id, subject_ref_id, title, description, to_char(due_date, 'YYYY-MM-DD') AS due_date, created_by, created_at,
               attachment_url, attachment_name, shared_at`,
    [schoolId, input.classId, subjectName.slice(0, 50), input.subjectId, input.title, input.description, input.dueDate, user.teacher_id,
     input.attachmentUrl, input.attachmentName, body?.source === 'whatsapp' ? 'whatsapp' : 'portal']
  );
  return { ...rows[0], class_name: cls.rows[0].name, subject_name: subjectName };
}

// Tells the class: a Student Portal notification for every student and the
// WhatsApp template for every opted-in parent. Never throws; returns the
// notification service's { sent, failed, skipped } counts.
export async function notifyHomeworkAssigned(homework) {
  try {
    const students = await pool.query('SELECT id FROM students WHERE class_id = $1 AND school_id = $2 ORDER BY id', [
      homework.class_id,
      homework.school_id,
    ]);
    const recipients = students.rows.flatMap((s) => [
      { type: 'student', studentId: s.id },
      { type: 'parent', studentId: s.id },
    ]);
    return await sendNotification({
      triggerEvent: 'homework_assigned',
      schoolId: homework.school_id,
      recipients,
      batchKey: `homework:${homework.id}`,
      attachments: homework.attachment_url ? [{ url: homework.attachment_url, type: 'document' }] : [],
      variables: {
        subject: homework.subject_name || homework.subject_id,
        title: homework.title,
        description: homework.description || '',
        due_date: homework.due_date ? formatNotifyDate(homework.due_date) : 'no due date',
      },
    });
  } catch (err) {
    console.error(`homework_assigned notification fan-out failed for homework ${homework?.id}:`, err.message);
    return { sent: 0, failed: 0, skipped: 0 };
  }
}

// One-time share to the whole class. The UPDATE ... WHERE shared_at IS NULL is
// the latch: only the first caller gets a row back, so the class is messaged
// exactly once however many times (or from however many devices) this is hit.
// The same caller that wins the latch performs the fan-out.
export async function shareHomework(user, id) {
  const homeworkId = positiveInt(id);
  if (!homeworkId) throw new HomeworkError(404, 'Homework not found');
  const claimed = await pool.query(
    `UPDATE homework h SET shared_at = CURRENT_TIMESTAMP
      WHERE h.id = $1 AND h.school_id = $2 AND h.shared_at IS NULL AND ($3::boolean OR h.created_by = $4)
      RETURNING h.id, h.school_id, h.class_id, h.subject_id, h.subject_ref_id, h.title, h.description,
                to_char(h.due_date, 'YYYY-MM-DD') AS due_date, h.attachment_url, h.attachment_name`,
    [homeworkId, user.school_id, user.role === 'principal', user.teacher_id]
  );
  if (!claimed.rowCount) {
    const exists = await pool.query(
      'SELECT shared_at FROM homework WHERE id = $1 AND school_id = $2 AND ($3::boolean OR created_by = $4)',
      [homeworkId, user.school_id, user.role === 'principal', user.teacher_id]
    );
    if (!exists.rowCount) throw new HomeworkError(404, 'Homework not found');
    throw new HomeworkError(409, 'This homework has already been shared with the class.');
  }
  const homework = { ...claimed.rows[0], subject_name: claimed.rows[0].subject_id };
  // Fan-out runs after the caller's response (a slow WhatsApp send must not
  // keep the teacher waiting); it never throws.
  notifyHomeworkAssigned(homework);
  return { shared: true };
}

// What a teacher has assigned (the principal sees the whole school), newest
// first, with how many students have ticked it done.
export async function listHomeworkForStaff(user) {
  const { rows } = await pool.query(
    `SELECT h.id, h.class_id, c.name AS class_name, h.subject_ref_id, h.subject_id AS subject_name,
            h.title, h.description, to_char(h.due_date, 'YYYY-MM-DD') AS due_date, h.created_at,
            h.created_by, t.name AS created_by_name, h.attachment_url, h.attachment_name, h.shared_at,
            (SELECT COUNT(*)::int FROM students s WHERE s.class_id = h.class_id AND s.school_id = h.school_id) AS student_count,
            (SELECT COUNT(*)::int FROM homework_completions hc WHERE hc.homework_id = h.id) AS done_count
       FROM homework h
       JOIN classes c ON c.id = h.class_id
       LEFT JOIN teachers t ON t.id = h.created_by
      WHERE h.school_id = $1 AND ($2::boolean OR h.created_by = $3)
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT 200`,
    [user.school_id, user.role === 'principal', user.teacher_id]
  );
  return rows;
}

// The teacher who assigned it (or the principal) can remove it. Students'
// "done" ticks go with it (ON DELETE CASCADE).
export async function deleteHomework(user, id) {
  const homeworkId = positiveInt(id);
  if (!homeworkId) throw new HomeworkError(404, 'Homework not found');
  const r = await pool.query(
    `DELETE FROM homework WHERE id = $1 AND school_id = $2 AND ($3::boolean OR created_by = $4) RETURNING id`,
    [homeworkId, user.school_id, user.role === 'principal', user.teacher_id]
  );
  if (!r.rowCount) throw new HomeworkError(404, 'Homework not found');
  return { deleted: true };
}
