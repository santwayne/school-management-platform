import express from 'express';
import multer from 'multer';
import path from 'path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';
import { s3, s3PublicUrl } from '../utils/s3.js';
import {
  getStudentProfile,
  upsertStudentProfile,
  upsertParentProfile,
  deleteParentProfile,
  getTeacherProfile,
  upsertTeacherProfile,
  canViewSensitiveStudentData,
  canEditStudentProfile,
} from '../services/profileService.js';
import { getStudentFeeSummary } from '../services/studentFees.js';
import { clearLearningProfile, getLearningProfile, saveLearningProfile } from '../services/studentMemory.js';
import {
  DOC_MAX_BYTES,
  DOC_MIME,
  DOC_TYPES,
  DocumentError,
  addStudentDocument,
  deleteStudentDocument,
  listStudentDocuments,
  streamStudentDocument,
} from '../services/studentDocuments.js';

const router = express.Router();

// Same S3 client/config as routes/settings.js — reused, not reconfigured,
// so a single AWS_S3_BUCKET/AWS_REGION pair backs logo + profile photos.

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB — resize/compress client-side before upload
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

async function uploadPhotoToS3(file, folder) {
  const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
  const key = `waynur/profiles/${folder}/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));
  return s3PublicUrl(key);
}

function handleUploadErrors(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Photo must be under 2 MB' });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

// Editing a student's profile (or its photos/parents/documents) is for staff
// who may see that student's sensitive data — it used to need only a login, so
// any teacher (or the student) could rewrite any profile.
async function requireStudentEditor(req, res, next) {
  try {
    if (!(await canEditStudentProfile(req.user.school_id, req.params.studentId, req.user))) {
      return res.status(403).json({ error: 'Only the principal or this student\'s class teacher can change this profile' });
    }
    next();
  } catch (err) {
    console.error('requireStudentEditor error:', err);
    res.status(500).json({ error: 'Failed to check permissions' });
  }
}

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOC_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!DOC_MIME[file.mimetype]) return cb(new Error('Upload a JPG, PNG, WebP or PDF file.'));
    cb(null, true);
  },
});

function handleDocUpload(req, res, next) {
  docUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File must be under 8 MB.' : err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

const docFail = (res, err, fallback) => {
  if (err instanceof DocumentError) return res.status(err.status).json({ error: err.message });
  console.error(`${fallback}:`, err);
  return res.status(500).json({ error: fallback });
};

// ---------------- Student profile ----------------

router.get('/students/:studentId', requireAuth, async (req, res) => {
  try {
    const profile = await getStudentProfile(req.user.school_id, req.params.studentId, req.user);
    if (!profile) return res.status(404).json({ error: 'Student not found' });
    res.json(profile);
  } catch (err) {
    console.error('getStudentProfile error:', err);
    res.status(500).json({ error: 'Failed to load student profile' });
  }
});

router.patch('/students/:studentId', requireAuth, requireStudentEditor, async (req, res) => {
  try {
    const updated = await upsertStudentProfile(req.user.school_id, req.params.studentId, req.body);
    res.json(updated);
  } catch (err) {
    console.error('upsertStudentProfile error:', err);
    res.status(500).json({ error: 'Failed to save student profile' });
  }
});

router.post('/students/:studentId/photo', requireAuth, requireStudentEditor, handleUploadErrors, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const photo_url = await uploadPhotoToS3(req.file, `students/${req.params.studentId}`);
    const updated = await upsertStudentProfile(req.user.school_id, req.params.studentId, { photo_url });
    res.json(updated);
  } catch (err) {
    console.error('Student photo upload error:', err);
    res.status(500).json({ error: 'Upload failed — check S3 credentials and bucket policy' });
  }
});

// ---------------- Supporting documents + fee summary ----------------

// Documents (ID proofs, certificates) follow the sensitive-data rule: principal,
// the class teacher, or the student themselves can view; only staff can change.
async function requireSensitiveViewer(req, res, next) {
  try {
    if (!(await canViewSensitiveStudentData(req.user.school_id, req.params.studentId, req.user))) {
      return res.status(403).json({ error: 'Not allowed to view this student\'s documents' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to check permissions' });
  }
}

router.get('/student-document-types', requireAuth, (_req, res) => {
  res.json(Object.entries(DOC_TYPES).map(([value, label]) => ({ value, label })));
});

router.get('/students/:studentId/documents', requireAuth, requireSensitiveViewer, async (req, res) => {
  try {
    res.json(await listStudentDocuments(req.user.school_id, req.params.studentId));
  } catch (err) {
    docFail(res, err, 'Failed to load documents');
  }
});

router.post('/students/:studentId/documents', requireAuth, requireStudentEditor, handleDocUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const exists = await pool.query('SELECT 1 FROM students WHERE id = $1 AND school_id = $2', [req.params.studentId, req.user.school_id]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Student not found' });
    const doc = await addStudentDocument({
      schoolId: req.user.school_id,
      studentId: req.params.studentId,
      uploadedBy: req.user.teacher_id,
      docType: req.body.doc_type,
      title: req.body.title,
      file: req.file,
    });
    res.status(201).json(doc);
  } catch (err) {
    docFail(res, err, 'Failed to upload document');
  }
});

router.get('/students/:studentId/documents/:docId/file', requireAuth, requireSensitiveViewer, async (req, res) => {
  try {
    await streamStudentDocument(req.user.school_id, req.params.studentId, req.params.docId, res);
  } catch (err) {
    if (!res.headersSent) docFail(res, err, 'Failed to open document');
  }
});

router.delete('/students/:studentId/documents/:docId', requireAuth, requireStudentEditor, async (req, res) => {
  try {
    await deleteStudentDocument(req.user.school_id, req.params.studentId, req.params.docId);
    res.json({ deleted: true });
  } catch (err) {
    docFail(res, err, 'Failed to delete document');
  }
});

// What the AI tutor has learned about this student (strengths, struggles,
// interests, pace, next steps). Staff who may see the student's sensitive data;
// teachers/principal can correct or clear it.
router.get('/students/:studentId/learning', requireAuth, requireSensitiveViewer, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Not allowed' });
  try {
    res.json((await getLearningProfile(req.user.school_id, req.params.studentId)) || null);
  } catch (err) {
    console.error('Learning profile error:', err);
    res.status(500).json({ error: 'Failed to load learning profile' });
  }
});
router.put('/students/:studentId/learning', requireAuth, requireStudentEditor, async (req, res) => {
  try {
    res.json(await saveLearningProfile(req.user.school_id, req.params.studentId, req.user.teacher_id, req.body || {}));
  } catch (err) {
    console.error('Save learning profile error:', err);
    res.status(500).json({ error: 'Failed to save learning profile' });
  }
});
router.delete('/students/:studentId/learning', requireAuth, requireStudentEditor, async (req, res) => {
  try {
    await clearLearningProfile(req.user.school_id, req.params.studentId);
    res.json({ cleared: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear learning profile' });
  }
});

// Fee structure + paid/unpaid for one student: finance staff, the class
// teacher/principal, or the student themselves.
router.get('/students/:studentId/fees', requireAuth, async (req, res) => {
  try {
    const { school_id: schoolId, role } = req.user;
    const allowed = role === 'accountant' || (await canViewSensitiveStudentData(schoolId, req.params.studentId, req.user));
    if (!allowed) return res.status(403).json({ error: 'Not allowed to view this student\'s fees' });
    const summary = await getStudentFeeSummary(schoolId, req.params.studentId);
    if (!summary) return res.status(404).json({ error: 'Student not found' });
    res.json(summary);
  } catch (err) {
    console.error('Student fee summary error:', err);
    res.status(500).json({ error: 'Failed to load fee details' });
  }
});

// ---------------- Parent profiles (father/mother/guardian rows) ----------------

router.post('/students/:studentId/parents', requireAuth, requireStudentEditor, async (req, res) => {
  try {
    const saved = await upsertParentProfile(req.user.school_id, req.params.studentId, req.body);
    res.json(saved);
  } catch (err) {
    console.error('upsertParentProfile error:', err);
    res.status(500).json({ error: 'Failed to save parent profile' });
  }
});

router.post('/students/:studentId/parents/:parentProfileId/photo', requireAuth, requireStudentEditor, handleUploadErrors, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const photo_url = await uploadPhotoToS3(req.file, `parents/${req.params.parentProfileId}`);
    const saved = await upsertParentProfile(req.user.school_id, req.params.studentId, {
      id: req.params.parentProfileId,
      photo_url,
    });
    if (!saved) return res.status(404).json({ error: 'Parent profile not found' });
    res.json(saved);
  } catch (err) {
    console.error('Parent photo upload error:', err);
    res.status(500).json({ error: 'Upload failed — check S3 credentials and bucket policy' });
  }
});

router.delete('/students/:studentId/parents/:parentProfileId', requireAuth, requireStudentEditor, async (req, res) => {
  try {
    const ok = await deleteParentProfile(req.user.school_id, req.params.studentId, req.params.parentProfileId);
    if (!ok) return res.status(404).json({ error: 'Parent profile not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteParentProfile error:', err);
    res.status(500).json({ error: 'Failed to delete parent profile' });
  }
});

// ---------------- Teacher profile ----------------

router.get('/teachers/:teacherId', requireAuth, async (req, res) => {
  try {
    const profile = await getTeacherProfile(req.user.school_id, req.params.teacherId, req.user);
    if (!profile) return res.status(404).json({ error: 'Teacher not found' });
    res.json(profile);
  } catch (err) {
    console.error('getTeacherProfile error:', err);
    res.status(500).json({ error: 'Failed to load teacher profile' });
  }
});

router.patch('/teachers/:teacherId', requireAuth, async (req, res) => {
  // Self-edit or SuperAdmin/Principal only.
  const isSelf = req.user.role === 'teacher' && String(req.user.teacher_id) === String(req.params.teacherId);
  const isAdmin = req.user.role === 'super_admin' || req.user.role === 'principal';
  if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Not authorized to edit this profile' });

  try {
    const updated = await upsertTeacherProfile(req.user.school_id, req.params.teacherId, req.body);
    res.json(updated);
  } catch (err) {
    console.error('upsertTeacherProfile error:', err);
    res.status(500).json({ error: 'Failed to save teacher profile' });
  }
});

router.post('/teachers/:teacherId/photo', requireAuth, handleUploadErrors, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const isSelf = req.user.role === 'teacher' && String(req.user.teacher_id) === String(req.params.teacherId);
  const isAdmin = req.user.role === 'super_admin' || req.user.role === 'principal';
  if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Not authorized to edit this profile' });

  try {
    const photo_url = await uploadPhotoToS3(req.file, `teachers/${req.params.teacherId}`);
    const updated = await upsertTeacherProfile(req.user.school_id, req.params.teacherId, { photo_url });
    res.json(updated);
  } catch (err) {
    console.error('Teacher photo upload error:', err);
    res.status(500).json({ error: 'Upload failed — check S3 credentials and bucket policy' });
  }
});

// ---------------- Class teacher assignment (used by the sensitivity gate) ----------------

router.patch('/classes/:classId/class-teacher', requireAuth, requirePrincipal, async (req, res) => {
  const { teacher_id } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE classes SET class_teacher_id = $1 WHERE id = $2 AND school_id = $3 RETURNING *`,
      [teacher_id || null, req.params.classId, req.user.school_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Class not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Assign class teacher error:', err);
    res.status(500).json({ error: 'Failed to assign class teacher' });
  }
});

export default router;
