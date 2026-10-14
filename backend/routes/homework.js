import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  HomeworkError,
  createHomework,
  deleteHomework,
  homeworkOptions,
  listHomeworkForStaff,
  shareHomework,
} from '../services/homeworkService.js';

// Staff side of homework (the student side lives in routes/studentPortal.js).
const router = express.Router();

function staffOnly(req, res, next) {
  if (!req.user || !['teacher', 'principal'].includes(req.user.role) || !req.user.teacher_id) {
    return res.status(403).json({ error: 'Teacher or Principal role required' });
  }
  next();
}

function fail(res, err, fallback) {
  if (err instanceof HomeworkError) return res.status(err.status).json({ error: err.message });
  console.error(`${fallback}:`, err);
  return res.status(500).json({ error: fallback });
}

router.use(requireAuth, staffOnly);

// GET /api/homework/options — class + subject pairs this login can assign for.
router.get('/options', async (req, res) => {
  try {
    res.json(await homeworkOptions(req.user));
  } catch (err) {
    fail(res, err, 'Failed to load classes');
  }
});

// GET /api/homework — what this teacher assigned (principal: whole school).
router.get('/', async (req, res) => {
  try {
    res.json(await listHomeworkForStaff(req.user));
  } catch (err) {
    fail(res, err, 'Failed to load homework');
  }
});

// POST /api/homework — assign homework to a class. By default it is shared
// with students + parents straight away (one time); pass share: false to save
// it as a draft and share later with POST /api/homework/:id/share.
router.post('/', async (req, res) => {
  try {
    const homework = await createHomework(req.user, req.body);
    if (req.body?.share === false) return res.status(201).json(homework);
    await shareHomework(req.user, homework.id);
    res.status(201).json({ ...homework, shared_at: new Date().toISOString() });
  } catch (err) {
    fail(res, err, 'Failed to create homework');
  }
});

// POST /api/homework/:id/share — one-time share of a saved homework with the class.
router.post('/:id/share', async (req, res) => {
  try {
    res.json(await shareHomework(req.user, req.params.id));
  } catch (err) {
    fail(res, err, 'Failed to share homework');
  }
});

// DELETE /api/homework/:id — remove one (its author, or the principal).
router.delete('/:id', async (req, res) => {
  try {
    res.json(await deleteHomework(req.user, req.params.id));
  } catch (err) {
    fail(res, err, 'Failed to delete homework');
  }
});

export default router;
