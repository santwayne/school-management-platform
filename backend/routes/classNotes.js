import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';
import { classNoteQueue } from '../config/queue.js';
import { sendTextMessage } from '../services/whatsappService.js';

const router = express.Router();

// POST /api/class-notes — create a note (teacher must be assigned to this class+subject, unless principal)
router.post('/class-notes', requireAuth, async (req, res) => {
  const { class_id, subject_id, title, body_text, attachment_url } = req.body;
  const schoolId = req.user.school_id;
  const teacherId = req.user.teacher_id;

  if (!class_id || !title) {
    return res.status(400).json({ error: 'class_id and title are required' });
  }
  if (!teacherId) {
    return res.status(403).json({ error: 'Teacher or principal login required' });
  }

  try {
    if (req.user.role !== 'principal' && subject_id) {
      const assigned = await pool.query(
        'SELECT 1 FROM class_subject_teachers WHERE class_id = $1 AND subject_id = $2 AND teacher_id = $3',
        [class_id, subject_id, teacherId]
      );
      if (assigned.rowCount === 0) {
        return res.status(403).json({ error: 'You are not assigned to this class/subject' });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO class_notes (school_id, class_id, subject_id, teacher_id, title, body_text, attachment_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [schoolId, class_id, subject_id || null, teacherId, title, body_text || null, attachment_url || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/class-notes/:id/send — fan out to all parents of students in that class, queued
router.post('/class-notes/:id/send', requireAuth, async (req, res) => {
  const { id } = req.params;
  const schoolId = req.user.school_id;

  try {
    const noteRes = await pool.query('SELECT * FROM class_notes WHERE id = $1 AND school_id = $2', [id, schoolId]);
    if (noteRes.rowCount === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const note = noteRes.rows[0];

    // One delivery row per distinct parent of a student in this class (a
    // parent with two kids in the same class shouldn't get the note twice).
    const parents = await pool.query(
      `SELECT DISTINCT p.id FROM students s JOIN parents p ON s.parent_id = p.id WHERE s.class_id = $1 AND s.school_id = $2`,
      [note.class_id, schoolId]
    );

    if (parents.rowCount === 0) {
      return res.status(400).json({ error: 'No parents found for this class — nothing to send' });
    }

    for (const p of parents.rows) {
      await pool.query(
        `INSERT INTO class_note_deliveries (note_id, parent_id, status) VALUES ($1, $2, 'PENDING')`,
        [id, p.id]
      );
    }

    await classNoteQueue.add('sendClassNote', { noteId: Number(id) });
    res.status(202).json({ success: true, queued_for: parents.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/class-notes?class_id= — history + delivery status per note
router.get('/class-notes', requireAuth, async (req, res) => {
  const schoolId = req.user.school_id;
  const { class_id } = req.query;

  try {
    const params = [schoolId];
    let where = 'cn.school_id = $1';
    if (class_id) {
      params.push(class_id);
      where += ` AND cn.class_id = $${params.length}`;
    }

    const notes = await pool.query(
      `SELECT cn.*, t.name AS teacher_name FROM class_notes cn JOIN teachers t ON cn.teacher_id = t.id WHERE ${where} ORDER BY cn.created_at DESC`,
      params
    );

    const noteIds = notes.rows.map((n) => n.id);
    let deliveryCounts = {};
    if (noteIds.length > 0) {
      const deliveries = await pool.query(
        `SELECT note_id, status, COUNT(*) AS count FROM class_note_deliveries WHERE note_id = ANY($1) GROUP BY note_id, status`,
        [noteIds]
      );
      for (const d of deliveries.rows) {
        deliveryCounts[d.note_id] = deliveryCounts[d.note_id] || {};
        deliveryCounts[d.note_id][d.status] = Number(d.count);
      }
    }

    res.json(notes.rows.map((n) => ({ ...n, delivery_counts: deliveryCounts[n.id] || {} })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/staff-broadcast — principal sends a WhatsApp message directly to opted-in teachers
router.post('/staff-broadcast', requireAuth, requirePrincipal, async (req, res) => {
  const { message } = req.body;
  const schoolId = req.user.school_id;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const teachers = await pool.query(
      `SELECT id, name, whatsapp_number FROM teachers
       WHERE school_id = $1 AND whatsapp_opt_in_status = 'OPTED_IN' AND whatsapp_number IS NOT NULL`,
      [schoolId]
    );

    const results = [];
    for (const t of teachers.rows) {
      try {
        await sendTextMessage(t.whatsapp_number, message);
        results.push({ teacher_id: t.id, status: 'SENT' });
      } catch (err) {
        results.push({ teacher_id: t.id, status: 'FAILED', error: err.message });
      }
    }

    res.json({ success: true, sent_to: results.filter((r) => r.status === 'SENT').length, total_opted_in: teachers.rowCount, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teachers/whatsapp-opt-in — a teacher opts themself in/out (must originate from the user, not an admin)
router.post('/teachers/whatsapp-opt-in', requireAuth, async (req, res) => {
  const { whatsapp_number, opt_in } = req.body;
  const teacherId = req.user.teacher_id;

  if (!teacherId) {
    return res.status(403).json({ error: 'Teacher login required' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE teachers SET
         whatsapp_number = COALESCE($1, whatsapp_number),
         whatsapp_opt_in_status = $2
       WHERE id = $3 RETURNING id, whatsapp_number, whatsapp_opt_in_status`,
      [whatsapp_number || null, opt_in ? 'OPTED_IN' : 'OPTED_OUT', teacherId]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
