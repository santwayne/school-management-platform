import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';
import { send as sendNotification } from '../services/notificationService.js';

const router = express.Router();

// ============================================================
// 4.1 — Bulk upload / update student data
// Rows are parsed client-side (xlsx/SheetJS, per AdminReports.jsx's existing
// pattern) and posted here as plain JSON. Each row is validated and applied
// independently — one bad row never blocks the rest, and every row gets a
// row_number-keyed result so the admin can fix and re-upload just the
// failures instead of guessing which of N rows didn't take.
// ============================================================
router.post('/bulk-upsert', requireAuth, requirePrincipal, async (req, res) => {
  const { rows } = req.body; // [{ row_number, name, class_name, grade, parent_name, parent_phone, login_id }]
  const schoolId = req.user.school_id;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'A non-empty rows array is required' });
  }

  const classCache = new Map();
  async function resolveClassId(className) {
    if (!className) return { class_id: null };
    const key = className.trim().toLowerCase();
    if (classCache.has(key)) return classCache.get(key);
    const found = await pool.query(
      'SELECT id FROM classes WHERE school_id = $1 AND LOWER(name) = $2',
      [schoolId, key]
    );
    const result = found.rowCount > 0 ? { class_id: found.rows[0].id } : { error: `Unknown class "${className}"` };
    classCache.set(key, result);
    return result;
  }

  const results = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const rowNumber = row.row_number ?? results.length + 1;
    const name = (row.name || '').trim();

    if (!name) {
      failed++;
      results.push({ row_number: rowNumber, status: 'error', message: 'Name is required', input: row });
      continue;
    }

    let classId = null;
    if (row.class_name) {
      const resolved = await resolveClassId(row.class_name);
      if (resolved.error) {
        failed++;
        results.push({ row_number: rowNumber, status: 'error', message: resolved.error, input: row });
        continue;
      }
      classId = resolved.class_id;
    }

    try {
      // Resolve/attach a parent record if phone was supplied.
      let parentId = null;
      if (row.parent_phone) {
        const phone = String(row.parent_phone).trim();
        const existingParent = await pool.query(
          'SELECT id FROM parents WHERE school_id = $1 AND phone = $2',
          [schoolId, phone]
        );
        if (existingParent.rowCount > 0) {
          parentId = existingParent.rows[0].id;
          if (row.parent_name) {
            await pool.query('UPDATE parents SET name = $1 WHERE id = $2', [row.parent_name.trim(), parentId]);
          }
        } else {
          const newParent = await pool.query(
            `INSERT INTO parents (school_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
            [schoolId, (row.parent_name || `Parent of ${name}`).trim(), phone]
          );
          parentId = newParent.rows[0].id;
        }
      }

      // An existing student is identified by login_id (preferred, since it's
      // the stable external identifier already shown to admins) or by an
      // explicit student_id — anything else is treated as a new enrollment.
      let existing = null;
      if (row.login_id) {
        const found = await pool.query(
          'SELECT id FROM students WHERE school_id = $1 AND login_id = $2',
          [schoolId, String(row.login_id).trim()]
        );
        if (found.rowCount > 0) existing = found.rows[0];
        else {
          failed++;
          results.push({ row_number: rowNumber, status: 'error', message: `No existing student with login_id "${row.login_id}"`, input: row });
          continue;
        }
      } else if (row.student_id) {
        const found = await pool.query(
          'SELECT id FROM students WHERE school_id = $1 AND id = $2',
          [schoolId, row.student_id]
        );
        if (found.rowCount > 0) existing = found.rows[0];
        else {
          failed++;
          results.push({ row_number: rowNumber, status: 'error', message: `No existing student with id ${row.student_id}`, input: row });
          continue;
        }
      }

      if (existing) {
        const updateRes = await pool.query(
          `UPDATE students SET
             name = $1,
             class_id = COALESCE($2, class_id),
             grade = COALESCE($3, grade),
             parent_id = COALESCE($4, parent_id)
           WHERE id = $5 AND school_id = $6
           RETURNING id, name, login_id`,
          [name, classId, row.grade || null, parentId, existing.id, schoolId]
        );
        updated++;
        results.push({ row_number: rowNumber, status: 'updated', student: updateRes.rows[0] });
      } else {
        const randHex = Math.random().toString(36).substring(2, 6).toUpperCase();
        const loginId = `STD-${schoolId}-${randHex}`;
        const defaultPin = String(Math.floor(1000 + Math.random() * 9000));
        const pinHash = await bcrypt.hash(defaultPin, 10);

        const insertRes = await pool.query(
          `INSERT INTO students (school_id, class_id, name, grade, login_id, pin_hash, parent_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, login_id`,
          [schoolId, classId, name, row.grade || null, loginId, pinHash, parentId]
        );
        created++;
        results.push({ row_number: rowNumber, status: 'created', student: { ...insertRes.rows[0], defaultPin } });

        // Parents have no web login (see schema.sql's Unified Notification
        // Service comment) — WhatsApp is the only way they ever see their
        // child's login_id + PIN, so send it as soon as we have a parent on
        // file with a phone number. Best-effort: never let a WhatsApp failure
        // block the bulk-upsert response (same defensive pattern used by
        // every other notificationService.send() call in this codebase).
        if (parentId) {
          try {
            await sendNotification({
              triggerEvent: 'student_credentials',
              schoolId,
              recipients: [{ type: 'parent', studentId: insertRes.rows[0].id }],
              variables: { login_id: loginId, pin: defaultPin },
            });
          } catch (notifyErr) {
            console.error('student_credentials notification failed:', notifyErr.message);
          }
        }
      }
    } catch (err) {
      failed++;
      results.push({ row_number: rowNumber, status: 'error', message: err.message, input: row });
    }
  }

  res.status(207).json({
    success: true,
    summary: { total: rows.length, created, updated, failed },
    results,
  });
});

// ============================================================
// 4.2 — Student strength reports (by class / grade, optional academic-year
// filter). ASSUMPTION: this schema has no dedicated "academic year" concept
// anywhere (checked schema.sql and every route) — so as a v1 stand-in, the
// filter is the calendar year of students.created_at (effectively "admitted
// in <year>"). Good enough for a first version; a real academic_years table
// would be a follow-up if the school's year doesn't track admission year.
// ============================================================
router.get('/strength-report', requireAuth, requirePrincipal, async (req, res) => {
  const schoolId = req.user.school_id;
  const { academic_year } = req.query;

  try {
    const params = [schoolId];
    let yearFilter = '';
    if (academic_year) {
      params.push(academic_year);
      yearFilter = `AND EXTRACT(YEAR FROM s.created_at) = $${params.length}`;
    }

    const byClass = await pool.query(
      `SELECT c.id AS class_id, COALESCE(c.name, 'Unassigned') AS class_name,
              COALESCE(s.grade, '—') AS grade, COUNT(*) AS student_count
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.school_id = $1 ${yearFilter}
       GROUP BY c.id, c.name, s.grade
       ORDER BY c.name NULLS LAST, s.grade`,
      params
    );

    const totalRes = await pool.query(
      `SELECT COUNT(*) AS total FROM students s WHERE s.school_id = $1 ${yearFilter}`,
      params
    );

    const yearsRes = await pool.query(
      `SELECT DISTINCT EXTRACT(YEAR FROM created_at)::int AS year
       FROM students WHERE school_id = $1 ORDER BY year DESC`,
      [schoolId]
    );

    res.json({
      rows: byClass.rows,
      total: parseInt(totalRes.rows[0].total, 10),
      available_years: yearsRes.rows.map((r) => r.year),
      assumption: 'Academic year is derived from each student\'s enrollment (created_at) year — this schema has no dedicated academic_year field yet.',
    });
  } catch (err) {
    console.error('Strength report error:', err);
    res.status(500).json({ error: 'Failed to generate strength report' });
  }
});

// ============================================================
// 4.6 — Observations (teacher-logged, admin-visible)
// ============================================================

// Teacher or Principal adds an observation for a student in their own school.
router.post('/observations', requireAuth, async (req, res) => {
  if (!['teacher', 'principal'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Teacher or Principal role required' });
  }
  const schoolId = req.user.school_id;
  const { student_id, note, visible_to_student } = req.body;
  if (!student_id || !note || !note.trim()) {
    return res.status(400).json({ error: 'student_id and note are required' });
  }
  try {
    const studentCheck = await pool.query('SELECT id FROM students WHERE id = $1 AND school_id = $2', [student_id, schoolId]);
    if (studentCheck.rowCount === 0) return res.status(404).json({ error: 'Student not found for this school' });

    const result = await pool.query(
      `INSERT INTO student_observations (school_id, student_id, teacher_id, note, visible_to_student)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [schoolId, student_id, req.user.teacher_id, note.trim(), visible_to_student !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add observation error:', err);
    res.status(500).json({ error: 'Failed to save observation' });
  }
});

// List observations for one student — used by both the teacher lookup view
// and the admin "view student" modal in Manage School.
router.get('/observations/student/:studentId', requireAuth, async (req, res) => {
  if (!['teacher', 'principal'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Teacher or Principal role required' });
  }
  const schoolId = req.user.school_id;
  try {
    const result = await pool.query(
      `SELECT o.id, o.note, o.visible_to_student, o.created_at, t.name AS teacher_name
       FROM student_observations o
       JOIN teachers t ON t.id = o.teacher_id
       JOIN students s ON s.id = o.student_id
       WHERE o.student_id = $1 AND s.school_id = $2
       ORDER BY o.created_at DESC`,
      [req.params.studentId, schoolId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List observations error:', err);
    res.status(500).json({ error: 'Failed to load observations' });
  }
});

// ============================================================
// 4.4 / 4.7 — Generic document/ID-card request queue (admin side).
// One shared queue: request_type is filtered via a comma-separated query
// param so the same endpoints power both the certificate-requests view and
// the ID-card-requests view in the frontend's single DocumentRequestQueue
// component, instead of duplicating routes per request type.
// ============================================================
router.get('/document-requests', requireAuth, requirePrincipal, async (req, res) => {
  const schoolId = req.user.school_id;
  const { request_type, status } = req.query;
  try {
    const params = [schoolId];
    let filters = '';
    if (request_type) {
      const types = String(request_type).split(',').map((t) => t.trim()).filter(Boolean);
      params.push(types);
      filters += ` AND dr.request_type = ANY($${params.length})`;
    }
    if (status) {
      params.push(status);
      filters += ` AND dr.status = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT dr.*, s.name AS student_name, s.login_id AS student_login_id, s.grade AS student_grade,
              c.name AS class_name, p.name AS parent_name,
              rv.name AS reviewed_by_name
       FROM document_requests dr
       JOIN students s ON s.id = dr.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN parents p ON p.id = s.parent_id
       LEFT JOIN teachers rv ON rv.id = dr.reviewed_by
       WHERE dr.school_id = $1 ${filters}
       ORDER BY dr.requested_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List document requests error:', err);
    res.status(500).json({ error: 'Failed to load document requests' });
  }
});

router.patch('/document-requests/:id', requireAuth, requirePrincipal, async (req, res) => {
  const schoolId = req.user.school_id;
  const { status, review_note, document_url } = req.body;
  const allowed = ['PENDING', 'APPROVED', 'REJECTED', 'READY'];
  if (status && !allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });
  }
  try {
    const result = await pool.query(
      `UPDATE document_requests SET
         status = COALESCE($1, status),
         review_note = COALESCE($2, review_note),
         document_url = COALESCE($3, document_url),
         reviewed_by = $4,
         reviewed_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND school_id = $6
       RETURNING *`,
      [status || null, review_note || null, document_url || null, req.user.teacher_id, req.params.id, schoolId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Request not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update document request error:', err);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// Single-student lookup with everything AdminCertificates.jsx needs to build
// a leaving-certificate PDF client-side (name, class, parent, login id, and
// enrollment date as the closest available stand-in for admission date).
router.get('/students/:id/certificate-data', requireAuth, requirePrincipal, async (req, res) => {
  const schoolId = req.user.school_id;
  try {
    const result = await pool.query(
      `SELECT s.id, s.name, s.grade, s.login_id, s.created_at AS enrolled_at,
              c.name AS class_name, p.name AS parent_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN parents p ON p.id = s.parent_id
       WHERE s.id = $1 AND s.school_id = $2`,
      [req.params.id, schoolId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Certificate data error:', err);
    res.status(500).json({ error: 'Failed to load student record' });
  }
});

export default router;
