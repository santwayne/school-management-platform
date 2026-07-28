import express from 'express';
import multer from 'multer';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pool from '../config/db.js';
import { requireAuth, requireStudent } from '../middleware/auth.js';
import { send as sendNotification } from '../services/notificationService.js';

const router = express.Router();

// Same S3 client convention as routes/settings.js and routes/profiles.js.
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 }, // 25MB/file — videos are bigger than profile photos
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/')) {
      return cb(new Error('Only image or video files are allowed'));
    }
    cb(null, true);
  },
});

function handleUploadErrors(req, res, next) {
  upload.array('media', 10)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Each file must be under 25 MB' });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

// Resolves visibility_scope to an actual, frozen student list AT SEND TIME —
// this list never changes later even if class membership changes (acceptance
// criteria). Note: no "section" entity exists in this schema (only classes),
// so only 'all' | 'class' | 'individual' are supported.
async function resolveRecipientStudentIds(schoolId, scope, { classId, studentIds }) {
  if (scope === 'all') {
    const { rows } = await pool.query('SELECT id FROM students WHERE school_id = $1', [schoolId]);
    return rows.map((r) => r.id);
  }
  if (scope === 'class') {
    if (!classId) throw new Error('class_id is required for scope=class');
    const { rows } = await pool.query('SELECT id FROM students WHERE school_id = $1 AND class_id = $2', [schoolId, classId]);
    return rows.map((r) => r.id);
  }
  if (scope === 'individual') {
    if (!studentIds || studentIds.length === 0) throw new Error('student_ids is required for scope=individual');
    const { rows } = await pool.query(
      'SELECT id FROM students WHERE school_id = $1 AND id = ANY($2::int[])',
      [schoolId, studentIds]
    );
    return rows.map((r) => r.id);
  }
  throw new Error(`Unsupported visibility_scope: ${scope}`);
}

async function uploadMediaFile(file, activityId) {
  const isVideo = file.mimetype.startsWith('video/');
  const ext = path.extname(file.originalname).toLowerCase() || (isVideo ? '.mp4' : '.jpg');
  const key = `waynur/activities/${activityId}/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));
  return {
    media_url: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
    media_type: isVideo ? 'video' : 'photo',
  };
}

// Create an activity: resolves recipients, creates the activity + recipient
// rows, uploads any attached media (partial success is fine — a failed
// upload is just skipped and flagged, never blocks the rest), then fans out
// the 'activity_shared' notification via the shared NotificationService.
router.post('/', requireAuth, handleUploadErrors, async (req, res) => {
  if (!['teacher', 'principal'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Teacher or Principal role required' });
  }
  const schoolId = req.user.school_id;
  const { title, description, activity_date, visibility_scope, class_id } = req.body;
  if (!title || !visibility_scope) {
    return res.status(400).json({ error: 'title and visibility_scope are required' });
  }

  let studentIds;
  try {
    const parsedStudentIds = req.body.student_ids ? JSON.parse(req.body.student_ids) : [];
    studentIds = await resolveRecipientStudentIds(schoolId, visibility_scope, {
      classId: class_id,
      studentIds: parsedStudentIds,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (studentIds.length === 0) {
    return res.status(400).json({ error: 'No students matched this recipient selection' });
  }

  const client = await pool.connect();
  let activity;
  try {
    await client.query('BEGIN');
    const activityRes = await client.query(
      `INSERT INTO activities (school_id, title, description, activity_date, created_by, visibility_scope)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [schoolId, title, description || null, activity_date || new Date().toISOString().slice(0, 10), req.user.teacher_id, visibility_scope]
    );
    activity = activityRes.rows[0];

    // Bulk-insert the frozen recipient list.
    const values = studentIds.map((_, i) => `($1, $${i + 2})`).join(',');
    await client.query(
      `INSERT INTO activity_recipients (activity_id, student_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      [activity.id, ...studentIds]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Activity create error:', err);
    return res.status(500).json({ error: 'Failed to create activity' });
  } finally {
    client.release();
  }

  // Upload media — failures here are per-file and don't roll back the
  // activity (acceptance criteria: partial success is fine, flag for retry).
  const uploadedMedia = [];
  const failedUploads = [];
  for (const file of req.files || []) {
    try {
      const { media_url, media_type } = await uploadMediaFile(file, activity.id);
      const mediaRes = await pool.query(
        `INSERT INTO activity_media (activity_id, media_url, media_type) VALUES ($1,$2,$3) RETURNING *`,
        [activity.id, media_url, media_type]
      );
      uploadedMedia.push(mediaRes.rows[0]);
    } catch (err) {
      console.error(`Activity media upload failed for "${file.originalname}":`, err.message);
      failedUploads.push(file.originalname);
    }
  }

  res.status(201).json({ ...activity, media: uploadedMedia, failed_uploads: failedUploads, recipient_count: studentIds.length });

  // Fire-and-forget fan-out — a slow/failed WhatsApp send must never delay
  // the Principal/teacher's response after creating the activity.
  sendNotification({
    triggerEvent: 'activity_shared',
    schoolId,
    recipients: studentIds.flatMap((id) => ([
      { type: 'student', studentId: id },
      { type: 'parent', studentId: id },
    ])),
    variables: { title, description: description || '' },
    attachments: uploadedMedia.map((m) => ({ url: m.media_url, type: m.media_type })),
    batchKey: `activity:${activity.id}`,
  }).catch((err) => console.error('activity_shared notification fan-out failed:', err.message));
});

// Principal/teacher list — all activities for the school, most recent first.
router.get('/', requireAuth, async (req, res) => {
  if (!['teacher', 'principal'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Teacher or Principal role required' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT a.*, COUNT(ar.student_id) AS recipient_count,
              COALESCE(json_agg(DISTINCT jsonb_build_object('id', am.id, 'media_url', am.media_url, 'media_type', am.media_type))
                       FILTER (WHERE am.id IS NOT NULL), '[]') AS media
         FROM activities a
         LEFT JOIN activity_recipients ar ON ar.activity_id = a.id
         LEFT JOIN activity_media am ON am.activity_id = a.id
        WHERE a.school_id = $1
        GROUP BY a.id
        ORDER BY a.activity_date DESC, a.created_at DESC`,
      [req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Activities list error:', err);
    res.status(500).json({ error: 'Failed to load activities' });
  }
});

// Student-facing feed — only activities where this student is a resolved
// recipient (persists indefinitely, not a one-time blast). This is the real
// equivalent of the spec's "parent dashboard feed" since Waynur students
// (not parents) have a web login.
router.get('/feed', requireAuth, requireStudent, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.description, a.activity_date,
              COALESCE(json_agg(DISTINCT jsonb_build_object('id', am.id, 'media_url', am.media_url, 'media_type', am.media_type, 'thumbnail_url', am.thumbnail_url))
                       FILTER (WHERE am.id IS NOT NULL), '[]') AS media
         FROM activity_recipients ar
         JOIN activities a ON a.id = ar.activity_id
         LEFT JOIN activity_media am ON am.activity_id = a.id
        WHERE ar.student_id = $1
        GROUP BY a.id
        ORDER BY a.activity_date DESC, a.created_at DESC`,
      [req.user.student_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Activity feed error:', err);
    res.status(500).json({ error: 'Failed to load activity feed' });
  }
});

export default router;
