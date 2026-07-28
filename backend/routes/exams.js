import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

// Manual marks entry per exam/term + auto-compiled report card PDFs.
// Deliberately separate from grading.js (AI-assisted OCR test grading) —
// see schema.sql comment above the exams/exam_marks tables.

// Returns true if this teacher is assigned to ANY subject in classId
// (used to gate report-card / roster-level access, where the caller isn't
// picking one specific subject).
async function teacherTeachesClass(schoolId, classId, teacherId) {
  const res = await pool.query(
    'SELECT 1 FROM class_subject_teachers WHERE school_id = $1 AND class_id = $2 AND teacher_id = $3 LIMIT 1',
    [schoolId, classId, teacherId]
  );
  return res.rowCount > 0;
}

// Returns true if this teacher is assigned to this exact class+subject
// (used to gate the marks grid, where the subject matters).
async function teacherTeachesClassSubject(schoolId, classId, subjectId, teacherId) {
  const res = await pool.query(
    'SELECT 1 FROM class_subject_teachers WHERE school_id = $1 AND class_id = $2 AND subject_id = $3 AND teacher_id = $4 LIMIT 1',
    [schoolId, classId, subjectId, teacherId]
  );
  return res.rowCount > 0;
}

// GET /api/exams?class_id= — list exams. Principal sees everything for the
// school; teachers only see exams for classes they're actually assigned to
// (via class_subject_teachers), so the exam picker doesn't leak other
// classes' exam names to a teacher who has no business seeing them.
router.get('/', requireAuth, async (req, res) => {
  const schoolId = req.user.school_id;
  const { class_id } = req.query;

  try {
    const params = [schoolId];
    let where = 'e.school_id = $1';
    if (class_id) {
      params.push(class_id);
      where += ` AND e.class_id = $${params.length}`;
    }

    let teacherScope = '';
    if (req.user.role !== 'principal') {
      if (!req.user.teacher_id) return res.status(403).json({ error: 'Teacher or Principal login required' });
      params.push(req.user.teacher_id);
      teacherScope = ` AND EXISTS (
        SELECT 1 FROM class_subject_teachers cst
        WHERE cst.school_id = e.school_id AND cst.class_id = e.class_id AND cst.teacher_id = $${params.length}
      )`;
    }

    const result = await pool.query(
      `SELECT e.id, e.name, e.term, e.class_id, c.name AS class_name, e.created_at
       FROM exams e JOIN classes c ON c.id = e.class_id
       WHERE ${where} ${teacherScope}
       ORDER BY e.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Exams list error:', err);
    res.status(500).json({ error: 'Failed to load exams' });
  }
});

// POST /api/exams — create an exam for a class. Principal only (exam
// creation/scheduling is an admin task; teachers just enter marks into
// exams the principal has already set up).
router.post('/', requireAuth, requirePrincipal, async (req, res) => {
  const schoolId = req.user.school_id;
  const { name, term, class_id } = req.body;

  if (!name || !name.trim() || !class_id) {
    return res.status(400).json({ error: 'name and class_id are required' });
  }

  try {
    const classCheck = await pool.query('SELECT id FROM classes WHERE id = $1 AND school_id = $2', [class_id, schoolId]);
    if (classCheck.rowCount === 0) return res.status(404).json({ error: 'Class not found for this school' });

    const result = await pool.query(
      `INSERT INTO exams (school_id, name, term, class_id) VALUES ($1, $2, $3, $4) RETURNING *`,
      [schoolId, name.trim(), term || null, class_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Exam create error:', err);
    res.status(500).json({ error: 'Failed to create exam' });
  }
});

// DELETE /api/exams/:id — principal only.
router.delete('/:id', requireAuth, requirePrincipal, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM exams WHERE id = $1 AND school_id = $2 RETURNING id', [
      req.params.id,
      req.user.school_id,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Exam not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Exam delete error:', err);
    res.status(500).json({ error: 'Failed to delete exam' });
  }
});

// GET /api/exams/:id/marks?subject_id= — roster for the exam's class, each
// row carrying any existing mark for that subject (so the entry grid can
// pre-fill on repeat visits/edits).
router.get('/:id/marks', requireAuth, async (req, res) => {
  const schoolId = req.user.school_id;
  const { id } = req.params;
  const { subject_id } = req.query;
  if (!subject_id) return res.status(400).json({ error: 'subject_id is required' });

  try {
    const examRes = await pool.query('SELECT * FROM exams WHERE id = $1 AND school_id = $2', [id, schoolId]);
    if (examRes.rowCount === 0) return res.status(404).json({ error: 'Exam not found' });
    const exam = examRes.rows[0];

    if (req.user.role !== 'principal') {
      if (!req.user.teacher_id) return res.status(403).json({ error: 'Teacher or Principal login required' });
      const allowed = await teacherTeachesClassSubject(schoolId, exam.class_id, subject_id, req.user.teacher_id);
      if (!allowed) return res.status(403).json({ error: 'You are not assigned to this class/subject' });
    }

    const result = await pool.query(
      `SELECT s.id AS student_id, s.name AS student_name,
              em.marks_obtained, em.max_marks
       FROM students s
       LEFT JOIN exam_marks em ON em.student_id = s.id AND em.exam_id = $1 AND em.subject_id = $2
       WHERE s.class_id = $3 AND s.school_id = $4
       ORDER BY s.name`,
      [id, subject_id, exam.class_id, schoolId]
    );
    res.json({ exam, students: result.rows });
  } catch (err) {
    console.error('Marks grid fetch error:', err);
    res.status(500).json({ error: 'Failed to load marks grid' });
  }
});

// POST /api/exams/:id/marks — bulk upsert marks for one subject.
// Body: { subject_id, marks: [{ student_id, marks_obtained, max_marks }] }
router.post('/:id/marks', requireAuth, async (req, res) => {
  const schoolId = req.user.school_id;
  const { id } = req.params;
  const { subject_id, marks } = req.body;

  if (!subject_id || !Array.isArray(marks) || marks.length === 0) {
    return res.status(400).json({ error: 'subject_id and a non-empty marks array are required' });
  }

  const client = await pool.connect();
  try {
    const examRes = await client.query('SELECT * FROM exams WHERE id = $1 AND school_id = $2', [id, schoolId]);
    if (examRes.rowCount === 0) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    const exam = examRes.rows[0];

    if (req.user.role !== 'principal') {
      if (!req.user.teacher_id) {
        return res.status(403).json({ error: 'Teacher or Principal login required' });
      }
      const allowed = await teacherTeachesClassSubject(schoolId, exam.class_id, subject_id, req.user.teacher_id);
      if (!allowed) {
        return res.status(403).json({ error: 'You are not assigned to this class/subject' });
      }
    }

    const subjectCheck = await client.query('SELECT id FROM subjects WHERE id = $1 AND school_id = $2', [subject_id, schoolId]);
    if (subjectCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Subject not found for this school' });
    }

    await client.query('BEGIN');
    let savedCount = 0;
    for (const m of marks) {
      if (!m.student_id || m.marks_obtained === '' || m.marks_obtained === null || m.marks_obtained === undefined) continue;
      // student_id scoped to this school+class so a stray id from the
      // client can't write marks onto some other school's student.
      const studentCheck = await client.query(
        'SELECT id FROM students WHERE id = $1 AND school_id = $2 AND class_id = $3',
        [m.student_id, schoolId, exam.class_id]
      );
      if (studentCheck.rowCount === 0) continue;

      await client.query(
        `INSERT INTO exam_marks (school_id, exam_id, student_id, subject_id, marks_obtained, max_marks, entered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (exam_id, student_id, subject_id)
         DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained, max_marks = EXCLUDED.max_marks, entered_by = EXCLUDED.entered_by`,
        [schoolId, id, m.student_id, subject_id, m.marks_obtained, m.max_marks || 100, req.user.teacher_id || null]
      );
      savedCount += 1;
    }
    await client.query('COMMIT');
    res.json({ success: true, saved_count: savedCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Marks save error:', err);
    res.status(500).json({ error: 'Failed to save marks' });
  } finally {
    client.release();
  }
});

// GET /api/exams/:id/students/:studentId/report — everything needed to
// render a report card PDF client-side (frontend follows the AdminReports.jsx
// buildPDF pattern — this just supplies the data).
router.get('/:id/students/:studentId/report', requireAuth, async (req, res) => {
  const schoolId = req.user.school_id;
  const { id, studentId } = req.params;

  try {
    const examRes = await pool.query(
      `SELECT e.*, c.name AS class_name FROM exams e JOIN classes c ON c.id = e.class_id
       WHERE e.id = $1 AND e.school_id = $2`,
      [id, schoolId]
    );
    if (examRes.rowCount === 0) return res.status(404).json({ error: 'Exam not found' });
    const exam = examRes.rows[0];

    if (req.user.role !== 'principal') {
      if (!req.user.teacher_id) return res.status(403).json({ error: 'Teacher or Principal login required' });
      const allowed = await teacherTeachesClass(schoolId, exam.class_id, req.user.teacher_id);
      if (!allowed) return res.status(403).json({ error: 'You are not assigned to this class' });
    }

    const studentRes = await pool.query(
      'SELECT id, name, login_id FROM students WHERE id = $1 AND school_id = $2 AND class_id = $3',
      [studentId, schoolId, exam.class_id]
    );
    if (studentRes.rowCount === 0) return res.status(404).json({ error: 'Student not found in this exam\'s class' });
    const student = studentRes.rows[0];

    const marksRes = await pool.query(
      `SELECT sub.name AS subject_name, em.marks_obtained, em.max_marks
       FROM exam_marks em JOIN subjects sub ON sub.id = em.subject_id
       WHERE em.exam_id = $1 AND em.student_id = $2
       ORDER BY sub.name`,
      [id, studentId]
    );

    const schoolRes = await pool.query(
      `SELECT sc.name AS school_name, ss.logo_url
       FROM schools sc LEFT JOIN school_settings ss ON ss.school_id = sc.id
       WHERE sc.id = $1`,
      [schoolId]
    );

    const totalObtained = marksRes.rows.reduce((a, r) => a + Number(r.marks_obtained), 0);
    const totalMax = marksRes.rows.reduce((a, r) => a + Number(r.max_marks), 0);
    const percentage = totalMax ? Number(((totalObtained / totalMax) * 100).toFixed(1)) : null;

    res.json({
      school: schoolRes.rows[0] || { school_name: null, logo_url: null },
      exam: { id: exam.id, name: exam.name, term: exam.term, class_name: exam.class_name },
      student,
      marks: marksRes.rows,
      total_obtained: totalObtained,
      total_max: totalMax,
      percentage,
    });
  } catch (err) {
    console.error('Report card data error:', err);
    res.status(500).json({ error: 'Failed to load report card data' });
  }
});

export default router;
