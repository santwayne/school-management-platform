import express from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { buildStudyPlan, isIsoDate, StudyPlanError } from '../utils/studyPlan.js';
import { createHomework, HomeworkError } from '../services/homeworkService.js';
import { istToday } from '../utils/aiAutomation.js';

// Syllabus-based planning: an exam's syllabus is split across the days before
// the exam into lesson plans, homework, chapter tests and revision.
const router = express.Router();

router.use(requireAuth, (req, res, next) => {
  if (!['teacher', 'principal'].includes(req.user?.role) || !req.user.teacher_id) {
    return res.status(403).json({ error: 'Teacher or Principal role required' });
  }
  next();
});

const isPrincipal = (u) => u.role === 'principal';

async function loadExam(user, examId) {
  const { rows } = await pool.query(
    `SELECT e.id, e.name, e.term, e.class_id, c.name AS class_name, to_char(e.exam_date, 'YYYY-MM-DD') AS exam_date
       FROM exams e JOIN classes c ON c.id = e.class_id WHERE e.id = $1 AND e.school_id = $2`,
    [Number(examId) || 0, user.school_id]
  );
  return rows[0] || null;
}

// Subjects of the exam's class this login may plan: every subject with a
// teacher for the principal, only their own for a teacher.
async function planSubjects(user, classId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT s.id AS subject_id, s.name AS subject_name
       FROM class_subject_teachers cst JOIN subjects s ON s.id = cst.subject_id
      WHERE cst.school_id = $1 AND cst.class_id = $2 AND ($3::boolean OR cst.teacher_id = $4)
      ORDER BY s.name`,
    [user.school_id, classId, isPrincipal(user), user.teacher_id]
  );
  return rows;
}

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof StudyPlanError || err instanceof HomeworkError) return res.status(err.status).json({ error: err.message });
    console.error('Exam plan error:', err);
    res.status(500).json({ error: 'Something went wrong with the exam plan' });
  }
};

// GET /api/exam-plans/:examId — exam, plannable subjects, syllabus, plan.
router.get('/:examId', wrap(async (req, res) => {
  const exam = await loadExam(req.user, req.params.examId);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const subjects = await planSubjects(req.user, exam.class_id);
  const ids = subjects.map((s) => s.subject_id);
  const [syllabus, plan] = await Promise.all([
    pool.query(
      `SELECT i.id, i.subject_id, s.name AS subject_name, i.chapter_name, i.topics, i.weight
         FROM exam_syllabus_items i JOIN subjects s ON s.id = i.subject_id
        WHERE i.exam_id = $1 AND i.subject_id = ANY($2::int[]) ORDER BY i.sort_order, i.id`,
      [exam.id, ids]
    ),
    pool.query(
      `SELECT p.id, p.subject_id, s.name AS subject_name, p.chapter_name, p.activity_type, p.title,
              to_char(p.planned_date, 'YYYY-MM-DD') AS planned_date, p.homework_id, p.lesson_plan_id
         FROM exam_plan_items p JOIN subjects s ON s.id = p.subject_id
        WHERE p.exam_id = $1 AND p.subject_id = ANY($2::int[]) ORDER BY p.planned_date, p.sort_order`,
      [exam.id, ids]
    ),
  ]);
  res.json({ exam, subjects, syllabus: syllabus.rows, plan: plan.rows });
}));

// PUT /api/exam-plans/:examId/syllabus — replace the syllabus for one subject.
// body: { subject_id, chapters: [{ chapter_name, topics?, weight? }] }
router.put('/:examId/syllabus', wrap(async (req, res) => {
  const exam = await loadExam(req.user, req.params.examId);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const subjectId = Number(req.body?.subject_id);
  const subjects = await planSubjects(req.user, exam.class_id);
  if (!subjects.some((s) => s.subject_id === subjectId)) return res.status(403).json({ error: 'You are not assigned to this subject for this class.' });

  const chapters = (Array.isArray(req.body?.chapters) ? req.body.chapters : [])
    .map((c) => ({
      chapter_name: String(c?.chapter_name || '').trim().slice(0, 255),
      topics: String(c?.topics || '').trim().slice(0, 2000) || null,
      weight: Math.min(10, Math.max(1, parseInt(c?.weight, 10) || 1)),
    }))
    .filter((c) => c.chapter_name);
  if (chapters.length > 100) return res.status(400).json({ error: 'At most 100 chapters per subject.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM exam_syllabus_items WHERE exam_id = $1 AND subject_id = $2 AND school_id = $3', [exam.id, subjectId, req.user.school_id]);
    for (let i = 0; i < chapters.length; i++) {
      await client.query(
        `INSERT INTO exam_syllabus_items (school_id, exam_id, subject_id, chapter_name, topics, weight, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.user.school_id, exam.id, subjectId, chapters[i].chapter_name, chapters[i].topics, chapters[i].weight, i]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  res.json({ saved: chapters.length });
}));

// POST /api/exam-plans/:examId/import-calendar — pre-fill one subject's
// syllabus from the class's syllabus calendar (Syllabus page).
router.post('/:examId/import-calendar', wrap(async (req, res) => {
  const exam = await loadExam(req.user, req.params.examId);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const subjectId = Number(req.body?.subject_id);
  const subjects = await planSubjects(req.user, exam.class_id);
  if (!subjects.some((s) => s.subject_id === subjectId)) return res.status(403).json({ error: 'You are not assigned to this subject for this class.' });
  const { rows } = await pool.query(
    `SELECT chapter_name FROM syllabus_calendar
      WHERE school_id = $1 AND class_id = $2 AND subject_ref_id = $3 AND chapter_name IS NOT NULL
      ORDER BY target_start_date, id`,
    [req.user.school_id, exam.class_id, subjectId]
  );
  res.json({ chapters: rows.map((r) => ({ chapter_name: r.chapter_name, topics: '', weight: 1 })) });
}));

// POST /api/exam-plans/:examId/generate — body { start_date, exam_date?, subject_id? }
// Rebuilds the plan for the chosen subject (or all the caller may plan).
// Items already turned into homework/lesson plans are kept and not duplicated.
router.post('/:examId/generate', wrap(async (req, res) => {
  const exam = await loadExam(req.user, req.params.examId);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const examDate = req.body?.exam_date || exam.exam_date;
  if (!isIsoDate(req.body?.start_date) || !isIsoDate(examDate)) throw new StudyPlanError('Enter a valid start date and exam date.');
  // A plan never starts in the past — lesson plans for days already gone
  // only clutter the list. A past start date is moved to today (IST).
  const today = istToday();
  const startMoved = req.body.start_date < today;
  const startDate = startMoved ? today : req.body.start_date;
  if (examDate <= today) throw new StudyPlanError('The exam date has already passed — set a future exam date to plan for it.');
  if (req.body?.exam_date && req.body.exam_date !== exam.exam_date) {
    await pool.query('UPDATE exams SET exam_date = $1 WHERE id = $2 AND school_id = $3', [examDate, exam.id, req.user.school_id]);
  }

  const subjects = await planSubjects(req.user, exam.class_id);
  const wanted = req.body?.subject_id ? subjects.filter((s) => s.subject_id === Number(req.body.subject_id)) : subjects;
  if (!wanted.length) return res.status(403).json({ error: 'You are not assigned to this subject for this class.' });
  const names = new Map(wanted.map((s) => [s.subject_id, s.subject_name]));

  const syl = await pool.query(
    `SELECT subject_id, chapter_name, topics, weight FROM exam_syllabus_items
      WHERE exam_id = $1 AND subject_id = ANY($2::int[]) ORDER BY sort_order, id`,
    [exam.id, wanted.map((s) => s.subject_id)]
  );
  const plan = buildStudyPlan({
    items: syl.rows.map((r) => ({ ...r, subject_name: names.get(r.subject_id) })),
    startDate,
    examDate,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM exam_plan_items WHERE exam_id = $1 AND school_id = $2 AND subject_id = ANY($3::int[])
         AND homework_id IS NULL AND lesson_plan_id IS NULL`,
      [exam.id, req.user.school_id, wanted.map((s) => s.subject_id)]
    );
    for (const p of plan) {
      await client.query(
        `INSERT INTO exam_plan_items (school_id, exam_id, subject_id, chapter_name, activity_type, title, planned_date, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [req.user.school_id, exam.id, p.subject_id, p.chapter_name, p.activity_type, p.title, p.planned_date, p.sort_order, req.user.teacher_id]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  res.status(201).json({ generated: plan.length, start_date: startDate, start_date_moved: startMoved });
}));

// POST /api/exam-plans/items/:id/create — turn a plan row into a DRAFT
// homework or lesson plan (nothing is sent to anyone until it is shared).
router.post('/items/:id/create', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*, e.class_id, to_char(p.planned_date, 'YYYY-MM-DD') AS planned_iso
       FROM exam_plan_items p JOIN exams e ON e.id = p.exam_id WHERE p.id = $1 AND p.school_id = $2`,
    [Number(req.params.id) || 0, req.user.school_id]
  );
  const item = rows[0];
  if (!item) return res.status(404).json({ error: 'Plan item not found' });
  const subjects = await planSubjects(req.user, item.class_id);
  if (!subjects.some((s) => s.subject_id === item.subject_id)) return res.status(403).json({ error: 'You are not assigned to this subject for this class.' });
  if (item.homework_id || item.lesson_plan_id) return res.status(409).json({ error: 'A draft was already created for this item.' });

  if (item.activity_type === 'homework') {
    const today = (await pool.query('SELECT CURRENT_DATE::text AS d')).rows[0].d;
    const hw = await createHomework(req.user, {
      class_id: item.class_id,
      subject_id: item.subject_id,
      title: item.title.slice(0, 255),
      description: `Planned for ${item.planned_iso}.`,
      due_date: item.planned_iso >= today ? item.planned_iso : null,
    });
    await pool.query('UPDATE exam_plan_items SET homework_id = $1 WHERE id = $2', [hw.id, item.id]);
    return res.status(201).json({ type: 'homework', id: hw.id });
  }
  if (item.activity_type === 'lesson_plan') {
    const lp = await pool.query(
      `INSERT INTO lesson_plans (school_id, class_id, subject_id, teacher_id, title, content, plan_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.user.school_id, item.class_id, item.subject_id, req.user.teacher_id, item.title.slice(0, 255), `Part of the exam plan for ${item.chapter_name}.`, item.planned_iso]
    );
    await pool.query('UPDATE exam_plan_items SET lesson_plan_id = $1 WHERE id = $2', [lp.rows[0].id, item.id]);
    return res.status(201).json({ type: 'lesson_plan', id: lp.rows[0].id });
  }
  return res.status(400).json({ error: 'Only homework and lesson-plan items can be turned into drafts.' });
}));

export default router;
