import express from 'express';
import PDFDocument from 'pdfkit';
import rateLimit from 'express-rate-limit';
import pool from '../config/db.js';
import { requireAuth, requireOperator } from '../middleware/auth.js';
import { AssistantError, attachments, chat, decideAction } from '../services/assistantService.js';
import { runReflection } from '../services/assistantReflection.js';
import { getSchoolBranding } from '../services/schoolBranding.js';
import { audit } from '../services/opsService.js';

// The AI assistant: principal and operator only.
const router = express.Router();
router.use(requireAuth, requireOperator);

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => `assistant:${req.user?.teacher_id}`,
  validate: false,
  message: { error: 'Too many messages — wait a moment.' },
});

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof AssistantError) return res.status(err.status).json({ error: err.message });
    console.error('Assistant error:', err);
    res.status(500).json({ error: err.status === 401 ? 'The AI service rejected the server key.' : 'The assistant hit a problem. Please try again.' });
  }
};

router.post('/chat', chatLimiter, wrap(async (req, res) => {
  res.json(await chat({ user: req.user, conversationId: req.body?.conversation_id, message: req.body?.message }));
}));

router.get('/conversations', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, updated_at FROM assistant_conversations WHERE school_id = $1 AND user_id = $2 ORDER BY updated_at DESC LIMIT 40`,
    [req.user.school_id, req.user.teacher_id]
  );
  res.json(rows);
}));

router.get('/conversations/:id', wrap(async (req, res) => {
  const own = await pool.query('SELECT id, title FROM assistant_conversations WHERE id = $1 AND school_id = $2 AND user_id = $3', [req.params.id, req.user.school_id, req.user.teacher_id]);
  if (!own.rowCount) return res.status(404).json({ error: 'Conversation not found' });
  const msgs = await pool.query('SELECT id, role, text, tools_used, rating, created_at FROM assistant_messages WHERE conversation_id = $1 ORDER BY id', [req.params.id]);
  const out = [];
  for (const m of msgs.rows) out.push({ id: m.id, role: m.role, text: m.text, rating: m.rating, created_at: m.created_at, ...(m.tools_used ? await attachments(req.user.school_id, m.tools_used) : {}) });
  res.json({ ...own.rows[0], messages: out });
}));

router.delete('/conversations/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM assistant_conversations WHERE id = $1 AND school_id = $2 AND user_id = $3', [req.params.id, req.user.school_id, req.user.teacher_id]);
  res.json({ deleted: true });
}));

// Thumbs up/down (+ optional note) — feeds the weekly self-review.
router.post('/messages/:id/feedback', wrap(async (req, res) => {
  const rating = Number(req.body?.rating);
  if (![1, -1].includes(rating)) return res.status(400).json({ error: 'rating must be 1 or -1' });
  const r = await pool.query(
    `UPDATE assistant_messages m SET rating = $3, feedback = $4
       FROM assistant_conversations c
      WHERE m.id = $1 AND m.role = 'assistant' AND m.conversation_id = c.id AND c.school_id = $2 AND c.user_id = $5 RETURNING m.id`,
    [req.params.id, req.user.school_id, rating, String(req.body?.feedback || '').slice(0, 500) || null, req.user.teacher_id]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'Message not found' });
  res.json({ ok: true });
}));

// ---- documents
router.get('/documents/:id/pdf', wrap(async (req, res) => {
  const d = await pool.query('SELECT d.title, d.body, d.created_at, s.name AS school_name FROM assistant_documents d JOIN schools s ON s.id = d.school_id WHERE d.id = $1 AND d.school_id = $2', [req.params.id, req.user.school_id]);
  if (!d.rowCount) return res.status(404).json({ error: 'Document not found' });
  const doc = d.rows[0];
  const brand = await getSchoolBranding(req.user.school_id);
  const pdf = new PDFDocument({ size: 'A4', margin: 60 });
  const chunks = [];
  pdf.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => pdf.on('end', () => r(Buffer.concat(chunks))));
  let x = 60;
  if (brand.logo) {
    try {
      const img = pdf.openImage(brand.logo);
      const scale = Math.min(60 / img.width, 48 / img.height);
      pdf.image(img, 60, 52, { width: img.width * scale, height: img.height * scale });
      x = 60 + img.width * scale + 12;
    } catch { /* logo is optional */ }
  }
  pdf.fontSize(18).fillColor(brand.hasColor ? brand.color : '#000').text(doc.school_name, x, 56);
  pdf.fontSize(9).fillColor('#777').text(new Date(doc.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }), x, 78);
  pdf.moveTo(60, 108).lineTo(535, 108).strokeColor('#ccc').stroke();
  // pdfkit's built-in fonts have no ₹ glyph.
  const clean = (t) => String(t).replace(/₹/g, 'Rs. ');
  pdf.fontSize(15).fillColor('#000').text(clean(doc.title), 60, 124, { width: 475 });
  pdf.moveDown(0.8).fontSize(11).fillColor('#222').text(clean(doc.body), { width: 475, lineGap: 3, paragraphGap: 8 });
  pdf.end();
  const buffer = await done;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${doc.title.replace(/[^\w]+/g, '_').slice(0, 60)}.pdf"`);
  res.send(buffer);
}));

// ---- actions awaiting approval
router.get('/actions', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, summary, action_key, status, result, created_at FROM assistant_actions WHERE school_id = $1 ORDER BY created_at DESC LIMIT 30`, [req.user.school_id]);
  res.json(rows);
}));
router.post('/actions/:id/approve', wrap(async (req, res) => res.json(await decideAction({ user: req.user, actionId: Number(req.params.id), approve: true }))));
router.post('/actions/:id/reject', wrap(async (req, res) => res.json(await decideAction({ user: req.user, actionId: Number(req.params.id), approve: false }))));

// ---- the brain: memory the team can see, add, approve and delete
router.get('/memory', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, kind, content, source, status, created_at FROM assistant_memory WHERE school_id = $1 AND status <> 'archived' ORDER BY (status = 'pending') DESC, created_at DESC`, [req.user.school_id]);
  res.json(rows);
}));
router.post('/memory', wrap(async (req, res) => {
  const content = String(req.body?.content || '').trim().slice(0, 500);
  if (!content) return res.status(400).json({ error: 'Write what the assistant should remember.' });
  const kind = ['fact', 'preference', 'policy', 'lesson'].includes(req.body?.kind) ? req.body.kind : 'fact';
  const r = await pool.query(`INSERT INTO assistant_memory (school_id, kind, content, source, status, created_by) VALUES ($1,$2,$3,'user','active',$4) RETURNING id`, [req.user.school_id, kind, content, req.user.teacher_id]);
  res.status(201).json({ id: r.rows[0].id });
}));
// Approve a pending lesson (status: active) or retire any memory (status: archived).
router.patch('/memory/:id', wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['active', 'archived'].includes(status)) return res.status(400).json({ error: 'status must be active or archived' });
  const r = await pool.query('UPDATE assistant_memory SET status = $3 WHERE id = $1 AND school_id = $2 RETURNING id', [req.params.id, req.user.school_id, status]);
  if (!r.rowCount) return res.status(404).json({ error: 'Memory not found' });
  await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: `assistant.memory_${status}`, entityType: 'assistant_memory', entityId: Number(req.params.id) });
  res.json({ ok: true });
}));

// ---- weekly self-review output
router.get('/suggestions', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, category, title, detail, evidence, status, created_at FROM assistant_suggestions WHERE school_id = $1 AND status = 'new' ORDER BY created_at DESC LIMIT 30`, [req.user.school_id]);
  res.json(rows);
}));
router.patch('/suggestions/:id', wrap(async (req, res) => {
  if (!['accepted', 'dismissed'].includes(req.body?.status)) return res.status(400).json({ error: 'status must be accepted or dismissed' });
  const r = await pool.query('UPDATE assistant_suggestions SET status = $3 WHERE id = $1 AND school_id = $2 RETURNING id', [req.params.id, req.user.school_id, req.body.status]);
  if (!r.rowCount) return res.status(404).json({ error: 'Suggestion not found' });
  res.json({ ok: true });
}));
router.post('/reflect', wrap(async (req, res) => {
  res.json(await runReflection(req.user.school_id, { actorId: req.user.teacher_id }));
}));

export default router;
