import express from 'express';
import pool from '../config/db.js';
import { generateAIHint, tagDoubtChapter } from '../services/aiService.js';
import { sendTextMessage, downloadMedia } from '../services/whatsappService.js';

const router = express.Router();

// Meta webhook verification handshake (required once, when you register
// the callback URL in the WhatsApp Business app dashboard).
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Incoming WhatsApp messages: absence-alert replies (cancels voice escalation)
// and doubt-solving (text / image OCR), gated by the same OPTED_IN check
// used everywhere else in the platform.
router.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const fromPhone = message.from;

    const complianceCheck = await pool.query(
      'SELECT id, school_id, opt_in_status FROM parents WHERE phone = $1',
      [fromPhone]
    );
    const parent = complianceCheck.rows[0];

    // STRICT COMPLIANCE GATE at the query level, not just the UI.
    if (!parent || parent.opt_in_status !== 'OPTED_IN') {
      console.log(`[Compliance] Message ignored from ${fromPhone} — not OPTED_IN.`);
      return res.sendStatus(200);
    }

    // Any reply within the escalation window cancels the pending voice call —
    // this is the piece that lets the worker's DB check actually find something.
    await pool.query(
      `UPDATE notification_log
       SET status = 'REPLIED', replied_at = CURRENT_TIMESTAMP
       WHERE parent_id = $1 AND status = 'SENT' AND replied_at IS NULL
       AND sent_at > NOW() - INTERVAL '24 hours'`,
      [parent.id]
    );

    let userMessageText = '';
    if (message.type === 'text') {
      userMessageText = message.text.body;
    } else if (message.type === 'image') {
      // Real OCR would run here (e.g. Google Vision / Textract) — kept as a
      // clearly-marked placeholder until an OCR provider is wired in.
      const { mimeType } = await downloadMedia(message.image.id).catch(() => ({ mimeType: null }));
      userMessageText = mimeType
        ? '[Image received — OCR extraction not yet configured]'
        : '[Could not download image]';
    } else {
      return res.sendStatus(200); // unsupported message type (audio/video/etc.) — ignore for now
    }

    const aiResponseHint = await generateAIHint(userMessageText);
    const chapterTag = await tagDoubtChapter(userMessageText, []); // pass real syllabus chapter list once available

    await pool.query(
      `INSERT INTO student_doubts (school_id, parent_id, original_query, ai_response_hint, chapter_tag)
       VALUES ($1, $2, $3, $4, $5)`,
      [parent.school_id, parent.id, userMessageText, aiResponseHint, chapterTag]
    );

    await sendTextMessage(fromPhone, aiResponseHint);

    res.sendStatus(200);
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    res.sendStatus(500);
  }
});

export default router;
