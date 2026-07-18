import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';

const router = express.Router();

// ---------- Catalog ----------

// GET /api/library/books?q=search — list/search the catalog
router.get('/books', requireAuth, async (req, res) => {
  const { q } = req.query;
  try {
    const params = [req.user.school_id];
    let where = 'school_id = $1';
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (title ILIKE $${params.length} OR author ILIKE $${params.length} OR isbn ILIKE $${params.length})`;
    }
    const { rows } = await pool.query(`SELECT * FROM library_books WHERE ${where} ORDER BY title ASC`, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/library/books — add a book (or a new batch of copies)
router.post('/books', requireAuth, requirePrincipal, async (req, res) => {
  const { title, author, isbn, category, total_copies = 1 } = req.body;
  if (!title || total_copies < 1) {
    return res.status(400).json({ error: 'title is required and total_copies must be at least 1' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO library_books (school_id, title, author, isbn, category, total_copies, available_copies)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
      [req.user.school_id, title, author || null, isbn || null, category || null, total_copies]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/library/books/:id
router.put('/books/:id', requireAuth, requirePrincipal, async (req, res) => {
  const { title, author, isbn, category, total_copies } = req.body;
  try {
    const { rows: existing } = await pool.query('SELECT * FROM library_books WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Book not found' });

    // If total_copies changes, shift available_copies by the same delta so
    // currently-issued copies stay accounted for correctly.
    const book = existing[0];
    const newTotal = total_copies != null ? total_copies : book.total_copies;
    const delta = newTotal - book.total_copies;
    const newAvailable = Math.max(0, book.available_copies + delta);

    const { rows } = await pool.query(
      `UPDATE library_books SET title = COALESCE($1, title), author = $2, isbn = $3, category = $4,
         total_copies = $5, available_copies = $6
       WHERE id = $7 AND school_id = $8 RETURNING *`,
      [title, author, isbn, category, newTotal, newAvailable, req.params.id, req.user.school_id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/library/books/:id
router.delete('/books/:id', requireAuth, requirePrincipal, async (req, res) => {
  try {
    const active = await pool.query(`SELECT id FROM library_issues WHERE book_id = $1 AND status = 'ISSUED'`, [req.params.id]);
    if (active.rowCount > 0) {
      return res.status(409).json({ error: 'Cannot delete a book with copies currently issued' });
    }
    const { rowCount } = await pool.query('DELETE FROM library_books WHERE id = $1 AND school_id = $2', [req.params.id, req.user.school_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Book not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Issue / return ----------

// POST /api/library/issue — issue a book to a student or staff member
router.post('/issue', requireAuth, requirePrincipal, async (req, res) => {
  const { book_id, student_id, teacher_id, due_date } = req.body;
  if (!book_id || !due_date || (!student_id && !teacher_id)) {
    return res.status(400).json({ error: 'book_id, due_date and either student_id or teacher_id are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: bookRows } = await client.query(
      'SELECT * FROM library_books WHERE id = $1 AND school_id = $2 FOR UPDATE',
      [book_id, req.user.school_id]
    );
    if (bookRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Book not found' });
    }
    if (bookRows[0].available_copies < 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No copies currently available' });
    }

    const { rows: issued } = await client.query(
      `INSERT INTO library_issues (school_id, book_id, student_id, teacher_id, due_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.school_id, book_id, student_id || null, teacher_id || null, due_date]
    );
    await client.query('UPDATE library_books SET available_copies = available_copies - 1 WHERE id = $1', [book_id]);
    await client.query('COMMIT');
    res.status(201).json(issued[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/library/issue/:id/return — mark a copy returned (with optional fine)
router.put('/issue/:id/return', requireAuth, requirePrincipal, async (req, res) => {
  const { fine_amount = 0 } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM library_issues WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [req.params.id, req.user.school_id]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Issue record not found' });
    }
    if (rows[0].status !== 'ISSUED') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Already ${rows[0].status.toLowerCase()}` });
    }

    const { rows: updated } = await client.query(
      `UPDATE library_issues SET status = 'RETURNED', returned_date = CURRENT_DATE, fine_amount = $1
       WHERE id = $2 RETURNING *`,
      [fine_amount, req.params.id]
    );
    await client.query('UPDATE library_books SET available_copies = available_copies + 1 WHERE id = $1', [rows[0].book_id]);
    await client.query('COMMIT');
    res.json(updated[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/library/issues?status=ISSUED — overview list (overdue auto-flagged)
router.get('/issues', requireAuth, async (req, res) => {
  const { status } = req.query;
  try {
    const params = [req.user.school_id];
    let where = 'li.school_id = $1';
    if (status) {
      params.push(status.toUpperCase());
      where += ` AND li.status = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT li.*, b.title AS book_title, s.name AS student_name, t.name AS teacher_name,
         (li.status = 'ISSUED' AND li.due_date < CURRENT_DATE) AS is_overdue
       FROM library_issues li
       JOIN library_books b ON b.id = li.book_id
       LEFT JOIN students s ON s.id = li.student_id
       LEFT JOIN teachers t ON t.id = li.teacher_id
       WHERE ${where} ORDER BY li.issued_date DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
