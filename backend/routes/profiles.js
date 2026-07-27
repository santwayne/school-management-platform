import express from 'express';
import multer from 'multer';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';
import {
  getStudentProfile,
  upsertStudentProfile,
  upsertParentProfile,
  deleteParentProfile,
  getTeacherProfile,
  upsertTeacherProfile,
} from '../services/profileService.js';

const router = express.Router();

// Same S3 client/config as routes/settings.js — reused, not reconfigured,
// so a single AWS_S3_BUCKET/AWS_REGION pair backs logo + profile photos.
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

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
  return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
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

router.patch('/students/:studentId', requireAuth, async (req, res) => {
  try {
    const updated = await upsertStudentProfile(req.user.school_id, req.params.studentId, req.body);
    res.json(updated);
  } catch (err) {
    console.error('upsertStudentProfile error:', err);
    res.status(500).json({ error: 'Failed to save student profile' });
  }
});

router.post('/students/:studentId/photo', requireAuth, handleUploadErrors, async (req, res) => {
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

// ---------------- Parent profiles (father/mother/guardian rows) ----------------

router.post('/students/:studentId/parents', requireAuth, async (req, res) => {
  try {
    const saved = await upsertParentProfile(req.user.school_id, req.params.studentId, req.body);
    res.json(saved);
  } catch (err) {
    console.error('upsertParentProfile error:', err);
    res.status(500).json({ error: 'Failed to save parent profile' });
  }
});

router.post('/students/:studentId/parents/:parentProfileId/photo', requireAuth, handleUploadErrors, async (req, res) => {
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

router.delete('/students/:studentId/parents/:parentProfileId', requireAuth, async (req, res) => {
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
