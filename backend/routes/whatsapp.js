import express from 'express';
import { webhookLimiter } from '../middleware/rateLimit.js';
import pool from '../config/db.js';
import { generateAIHint, tagDoubtChapter, extractCashSlip, extractDoubtImage } from '../services/aiService.js';
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

// Incoming WhatsApp messages: absence-alert replies (cancels voice escalation),
// doubt-solving (text / image OCR), and — new — cash slip photos from a
// registered fee collector, gated by the same OPTED_IN-style checks used
// everywhere else in the platform.
router.post('/webhook', webhookLimiter, async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const fromPhone = message.from;

    // Fee collector check runs first — a registered collector's number is
    // never also a parent number, so this branch is exclusive.
    const collectorRes = await pool.query(
      'SELECT id, school_id FROM fee_collectors WHERE whatsapp_number = $1',
      [fromPhone]
    );
    if (collectorRes.rowCount > 0) {
      const collector = collectorRes.rows[0];
      if (message.type !== 'image') {
        await sendTextMessage(fromPhone, 'Please send a photo of the cash receipt slip.');
        return res.sendStatus(200);
      }
      const { buffer, mimeType } = await downloadMedia(message.image.id).catch(() => ({ buffer: null, mimeType: null }));
      if (!buffer) {
        await sendTextMessage(fromPhone, "Couldn't download that photo — please try sending it again.");
        return res.sendStatus(200);
      }
      const base64Image = Buffer.from(buffer).toString('base64');
      const extraction = await extractCashSlip(base64Image, mimeType || 'image/jpeg');

      await pool.query(
        `INSERT INTO whatsapp_cash_intake (school_id, fee_collector_id, photo_base64, ai_extracted_amount, ai_extracted_student_hint)
         VALUES ($1, $2, $3, $4, $5)`,
        [collector.school_id, collector.id, base64Image, extraction.amount, extraction.student_hint]
      );

      await sendTextMessage(
        fromPhone,
        extraction.amount
          ? `Got it — ₹${extraction.amount}${extraction.student_hint ? ` for ${extraction.student_hint}` : ''}. Waiting for the accountant to confirm.`
          : "Got the photo, but couldn't clearly read the amount — the accountant will check it manually."
      );
      return res.sendStatus(200);
    }

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
      // A parent/student photographed a homework question or textbook page.
      // Previously this was a hardcoded placeholder that silently dropped
      // the content — now Claude vision reads the actual question so it
      // flows into the same doubt-solving pipeline as a typed message.
      const { buffer, mimeType } = await downloadMedia(message.image.id).catch(() => ({ buffer: null, mimeType: null }));
      if (!buffer) {
        userMessageText = '[Could not download image]';
      } else {
        const base64Image = Buffer.from(buffer).toString('base64');
        userMessageText = await extractDoubtImage(base64Image, mimeType || 'image/jpeg');
      }
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
