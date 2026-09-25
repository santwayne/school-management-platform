import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireOperator } from '../middleware/auth.js';
import { audit, registerAction } from '../services/opsService.js';
import { replyToParent } from '../services/parentAssistant.js';

// Operator view of the parent WhatsApp assistant: recent conversations,
// a thread, staff replies (inside WhatsApp's 24 h window) and takeover.
const router = express.Router();

export async function takeOver(schoolId, parentId, hours, user) {
  const h = Math.max(0, Math.min(Number(hours) || 24, 24 * 14));
  const p = await pool.query('SELECT id FROM parents WHERE id = $1 AND school_id = $2', [parentId, schoolId]);
  if (!p.rowCount) throw Object.assign(new Error('Parent not found'), { status: 404 });
  await pool.query(
    `INSERT INTO parent_conversations (parent_id, school_id, human_takeover_until)
     VALUES ($1, $2, CASE WHEN $3::int = 0 THEN NULL ELSE NOW() + make_interval(hours => $3::int) END)
     ON CONFLICT (parent_id) DO UPDATE SET human_takeover_until = EXCLUDED.human_takeover_until, updated_at = NOW()`,
    [parentId, schoolId, h]
  );
  await audit({ schoolId, actorType: 'user', actorId: user?.teacher_id, action: h ? 'parent.takeover' : 'parent.handback', entityType: 'parent', entityId: parentId, detail: { hours: h } });
  return { paused_hours: h };
}

registerAction('parent.takeover', ({ params, user }) => takeOver(user.school_id, params.parent_id, params.hours ?? 24, user));

router.use(requireAuth, requireOperator);

router.get('/', async (req, res) => {
  const schoolId = req.user.school_id;
  try {
    const r = await pool.query(
      `SELECT p.id AS parent_id, p.name, p.phone, pc.human_takeover_until, last.body AS last_message, last.direction AS last_direction,
              last.created_at AS last_at, last.intent AS last_intent, last.handled_by AS last_handled_by,
              (SELECT string_agg(s.name, ', ' ORDER BY s.name) FROM students s WHERE s.parent_id = p.id) AS children
       FROM parents p
       JOIN LATERAL (SELECT body, direction, created_at, intent, handled_by FROM parent_messages m WHERE m.parent_id = p.id ORDER BY id DESC LIMIT 1) last ON TRUE
       LEFT JOIN parent_conversations pc ON pc.parent_id = p.id
       WHERE p.school_id = $1
       ORDER BY last.created_at DESC LIMIT 200`,
      [schoolId]
    );
    // Share of parent questions the assistant answered on its own (7 days).
    const stats = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE direction = 'in')::int AS messages,
              COUNT(*) FILTER (WHERE direction = 'in' AND handled_by = 'assistant')::int AS answered,
              COUNT(*) FILTER (WHERE direction = 'in' AND handled_by = 'doubt_bot')::int AS homework_doubts,
              COUNT(*) FILTER (WHERE direction = 'in' AND handled_by = 'escalated')::int AS escalated,
              COUNT(*) FILTER (WHERE direction = 'out' AND delivery_status = 'failed')::int AS failed_sends
       FROM parent_messages WHERE school_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
      [schoolId]
    );
    const byIntent = await pool.query(
      `SELECT intent, COUNT(*)::int AS n FROM parent_messages WHERE school_id = $1 AND direction = 'in' AND intent IS NOT NULL
         AND created_at > NOW() - INTERVAL '7 days' GROUP BY intent ORDER BY n DESC`,
      [schoolId]
    );
    res.json({ items: r.rows, stats_7d: stats.rows[0], by_intent_7d: byIntent.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:parentId', async (req, res) => {
  try {
    const p = await pool.query(
      `SELECT p.id, p.name, p.phone, p.preferred_language, p.opt_in_status, pc.human_takeover_until, pc.last_inbound_at
       FROM parents p LEFT JOIN parent_conversations pc ON pc.parent_id = p.id WHERE p.id = $1 AND p.school_id = $2`,
      [req.params.parentId, req.user.school_id]
    );
    if (!p.rowCount) return res.status(404).json({ error: 'Parent not found' });
    const [msgs, kids] = await Promise.all([
      pool.query(
        `SELECT m.id, m.direction, m.body, m.intent, m.handled_by, m.delivery_status, m.created_at, s.name AS student_name
         FROM parent_messages m LEFT JOIN students s ON s.id = m.student_id WHERE m.parent_id = $1 ORDER BY m.id DESC LIMIT 200`,
        [p.rows[0].id]
      ),
      pool.query(`SELECT s.id, s.name, c.name AS class_name, c.section FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.parent_id = $1`, [p.rows[0].id]),
    ]);
    const lastIn = msgs.rows.find((m) => m.direction === 'in');
    const canReply = !!lastIn && Date.now() - new Date(lastIn.created_at) < 24 * 3600 * 1000 && p.rows[0].opt_in_status === 'OPTED_IN';
    res.json({ ...p.rows[0], children: kids.rows, messages: msgs.rows.reverse(), can_reply: canReply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:parentId/reply', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  try {
    const p = await pool.query('SELECT id, school_id, name, phone, opt_in_status FROM parents WHERE id = $1 AND school_id = $2', [req.params.parentId, req.user.school_id]);
    const parent = p.rows[0];
    if (!parent) return res.status(404).json({ error: 'Parent not found' });
    if (parent.opt_in_status !== 'OPTED_IN') return res.status(409).json({ error: 'This parent has not opted in to WhatsApp. Call them instead.' });
    const lastIn = await pool.query(`SELECT created_at FROM parent_messages WHERE parent_id = $1 AND direction = 'in' ORDER BY id DESC LIMIT 1`, [parent.id]);
    if (!lastIn.rowCount || Date.now() - new Date(lastIn.rows[0].created_at) > 24 * 3600 * 1000) {
      return res.status(409).json({ error: "WhatsApp only allows free replies within 24 hours of the parent's last message. Please call them." });
    }
    const ok = await replyToParent(parent, text, { handledBy: 'staff' });
    await takeOver(req.user.school_id, parent.id, 24, req.user);
    res.json({ ok, delivered: ok });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:parentId/takeover', async (req, res) => {
  try {
    res.json(await takeOver(req.user.school_id, Number(req.params.parentId), req.body?.hours ?? 24, req.user));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
