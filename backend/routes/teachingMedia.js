import express from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { MediaError, TEACHING_MEDIA_MAX_BYTES, TEACHING_MEDIA_TYPES, storeTeachingMedia } from '../services/teachingMedia.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TEACHING_MEDIA_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!TEACHING_MEDIA_TYPES[file.mimetype]) return cb(new Error('Attach a JPG, PNG, WebP, PDF, Word, PowerPoint or Excel file.'));
    cb(null, true);
  },
});

// POST /api/teaching-media/upload (multipart, field "file") — returns
// { url, name } to pass as attachment_url / attachment_name when creating
// homework or a lesson plan.
router.post('/upload', requireAuth, (req, res, next) => {
  if (!['teacher', 'principal'].includes(req.user?.role)) return res.status(403).json({ error: 'Teacher or principal role required' });
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File must be under 15 MB.' : err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const media = await storeTeachingMedia({
      schoolId: req.user.school_id,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
    });
    res.json({ url: media.url, name: media.name });
  } catch (err) {
    if (err instanceof MediaError) return res.status(err.status).json({ error: err.message });
    console.error('Teaching media upload error:', err);
    res.status(500).json({ error: 'Upload failed — check S3 credentials and that the bucket allows public read on teaching/*' });
  }
});

export default router;
