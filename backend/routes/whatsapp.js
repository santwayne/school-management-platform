import express from 'express';
import { normalizePhone } from '../utils/phone.js';
import { consentKeyword } from '../utils/consent.js';
import { audit } from '../services/opsService.js';
import { requireAuth, requireOperator } from '../middleware/auth.js';
import { handleEnquiryMessage, parentMessageIsForAdmissions } from '../services/admissionAgent.js';
import { handleParentMessage } from '../services/parentAssistant.js';
import crypto from 'crypto';
import axios from 'axios';
import { webhookLimiter } from '../middleware/rateLimit.js';
import pool from '../config/db.js';
import { generateAIHint, tagDoubtChapter, extractCashSlip, extractExpenseSlip, extractDoubtImage } from '../services/aiService.js';
import { sendTextMessage, sendTemplateMessage, downloadMedia, getSchoolWhatsApp } from '../services/whatsappService.js';

const router = express.Router();

// Verifies the `X-Hub-Signature-256` header Meta signs every webhook POST
// with (HMAC-SHA256 over the exact raw request body, keyed with the Meta
// App Secret — server.js's express.json() verify callback already captures
// req.rawBody for this). Without this check the endpoint trusted any POST
// body based on URL secrecy alone: anyone who found this URL could spoof a
// message "from" a real parent's phone to mark an absence-alert REPLIED
// (silently cancelling a real voice-call escalation), or "from" a
// registered fee collector's number to inject fake cash-slip/petty-cash
// records, plus burn paid AI API calls on demand.
//
// Fails closed if WHATSAPP_APP_SECRET isn't set, matching the same standard
// this codebase already applies to the Razorpay webhook (see
// routes/paymentLinks.js) rather than a weaker one for WhatsApp.
function isValidMetaSignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    console.error('[WhatsApp webhook] WHATSAPP_APP_SECRET not set — refusing to process webhook');
    return false;
  }

  const signatureHeader = req.get('x-hub-signature-256') || '';
  const [, providedHex] = signatureHeader.split('=');
  if (!providedHex || !req.rawBody) return false;

  const expectedHex = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex, 'hex');
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

// Debug: list templates and their approval status for the current WABA.
// Hit GET /api/whatsapp/debug-templates to see which templates are Active vs In Review.
// Staff-only: these two had no auth at all, so anyone on the internet could
// make the school's number send messages or list its templates.
router.get('/debug-templates', requireAuth, requireOperator, async (req, res) => {
  const creds = await getSchoolWhatsApp(req.user.school_id);
  if (!creds) return res.status(409).json({ error: 'WhatsApp is not connected for this school yet.' });
  const auth = { headers: { Authorization: `Bearer ${creds.accessToken}` } };

  try {
    const phoneRes = await axios.get(`https://graph.facebook.com/v21.0/${creds.phoneNumberId}`, {
      ...auth, params: { fields: 'name,verified_name,display_phone_number,status,quality_rating' },
    });
    // Templates belong to the WhatsApp Business Account, not the phone number.
    const wabaRes = creds.wabaId
      ? await axios.get(`https://graph.facebook.com/v21.0/${creds.wabaId}/message_templates`, { ...auth, params: { limit: 50 } }).catch(() => null)
      : null;

    res.json({
      phone_number_info: phoneRes.data,
      templates: wabaRes ? wabaRes.data : 'Could not fetch templates (no WABA ID saved for this school, or the token lacks whatsapp_business_management permission)',
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Debug: send hello_world (always-approved) to a number to confirm the pipeline works.
// POST /api/whatsapp/debug-send  { "to": "919876543210" }
router.post('/debug-send', requireAuth, requireOperator, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'to is required' });
  try {
    const result = await sendTemplateMessage(req.user.school_id, to, 'hello_world', 'en_US', []);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

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
  if (!isValidMetaSignature(req)) {
    console.warn('[WhatsApp webhook] Rejected POST with missing/invalid X-Hub-Signature-256.');
    return res.sendStatus(401);
  }

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];

    // Meta's async delivery-status callbacks (sent/delivered/read/failed)
    // arrive here as `statuses`, never as `messages` — this codebase had no
    // handler for them at all, so broadcasts.delivered_count only ever
    // reflected "Meta accepted the send request", not real delivery (P-3).
    // This matches each status update back to its broadcast_recipients row
    // by wa_message_id and rolls a confirmed-delivered count up to the
    // parent broadcast, without disturbing the original send-time counts.
    const statuses = change?.statuses;
    if (statuses && statuses.length > 0) {
      for (const s of statuses) {
        const newStatus = s.status === 'delivered' ? 'DELIVERED'
          : s.status === 'read' ? 'READ'
          : s.status === 'failed' ? 'FAILED'
          : null;
        if (!newStatus || !s.id) continue;
        try {
          const current = await pool.query(
            `SELECT id, broadcast_id, status FROM broadcast_recipients WHERE wa_message_id = $1`,
            [s.id]
          );
          const recipient = current.rows[0];
          // FAILED/READ are terminal for our purposes — never downgrade a
          // read receipt back to "delivered", and don't reopen a failure.
          if (!recipient || recipient.status === 'FAILED' || recipient.status === 'READ') continue;

          const wasAlreadyConfirmedDelivered = recipient.status === 'DELIVERED';
          await pool.query(
            `UPDATE broadcast_recipients SET status = $1, error_message = COALESCE($2, error_message), updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
            [newStatus, s.errors?.[0]?.title || null, recipient.id]
          );

          if ((newStatus === 'DELIVERED' || newStatus === 'READ') && !wasAlreadyConfirmedDelivered) {
            await pool.query(
              `UPDATE broadcasts SET confirmed_delivered_count = confirmed_delivered_count + 1 WHERE id = $1`,
              [recipient.broadcast_id]
            );
          } else if (newStatus === 'FAILED') {
            // Was counted as a successful send when Meta first accepted it —
            // now known to have never actually reached the phone.
            await pool.query(
              `UPDATE broadcasts SET delivered_count = GREATEST(delivered_count - 1, 0), failed_count = failed_count + 1 WHERE id = $1`,
              [recipient.broadcast_id]
            );
          }
        } catch (statusErr) {
          console.error('WhatsApp status webhook update failed:', statusErr.message);
        }
      }
      return res.sendStatus(200);
    }

    if (!message) return res.sendStatus(200);

    const fromPhone = message.from;
    // Meta sends `from` as bare digits ("919876543210"), but every phone in
    // our DB is stored E.164 with a plus ("+919876543210") by
    // utils/phone.js. Comparing the raw value never matched, so EVERY
    // inbound message from a parent was dropped as "not OPTED_IN" — replies
    // to absence alerts never cancelled the voice call, the doubt bot never
    // answered, and fee-collector photos were never matched. Match on both
    // forms so rows saved before normalisation existed still work.
    const fromCandidates = [...new Set([normalizePhone(fromPhone), fromPhone, `+${fromPhone}`].filter(Boolean))];

    // Every school has its own WhatsApp number now, so the number that
    // RECEIVED the message tells us which school it is for. Everything below
    // is scoped to that school: the same parent phone can exist at two
    // schools (siblings), and each school must only see — and reply from —
    // its own number. A number we don't recognise is not ours to act on.
    const inboundPhoneNumberId = change?.metadata?.phone_number_id || null;
    const inboundSchoolRes = inboundPhoneNumberId
      ? await pool.query('SELECT school_id FROM school_settings WHERE whatsapp_phone_number_id = $1 AND whatsapp_connected', [inboundPhoneNumberId])
      : { rows: [] };
    const inboundSchoolId = inboundSchoolRes.rows[0]?.school_id || null;
    if (!inboundSchoolId) {
      console.warn(`[WhatsApp webhook] Message for phone_number_id ${inboundPhoneNumberId} — not connected to any school, ignored.`);
      return res.sendStatus(200);
    }

    // Fee collector check runs first — a registered collector's number is
    // never also a parent number, so this branch is exclusive. The same
    // registered number also doubles as the "registered staff number" for
    // petty cash expense photos (Item 1 of the build spec) — a caption of
    // "petty"/"expense" routes the photo there instead of fee cash intake,
    // reusing this one photo-intake pipeline rather than building a second.
    const collectorRes = await pool.query(
      'SELECT id, school_id, name FROM fee_collectors WHERE whatsapp_number = ANY($1::text[]) AND school_id = $2',
      [fromCandidates, inboundSchoolId]
    );
    if (collectorRes.rowCount > 0) {
      const collector = collectorRes.rows[0];
      if (message.type !== 'image') {
        await sendTextMessage(inboundSchoolId, fromPhone, 'Please send a photo of the cash receipt slip (or a petty cash expense receipt, captioned "petty").');
        return res.sendStatus(200);
      }
      const { buffer, mimeType } = await downloadMedia(inboundSchoolId, message.image.id).catch(() => ({ buffer: null, mimeType: null }));
      if (!buffer) {
        await sendTextMessage(inboundSchoolId, fromPhone, "Couldn't download that photo — please try sending it again.");
        return res.sendStatus(200);
      }
      const base64Image = Buffer.from(buffer).toString('base64');
      const caption = (message.image.caption || '').trim().toLowerCase();

      if (caption.startsWith('petty') || caption.startsWith('expense')) {
        const extraction = await extractExpenseSlip(base64Image, mimeType || 'image/jpeg');
        await pool.query(
          `INSERT INTO petty_cash (school_id, requested_by, amount, purpose, status, receipt_photo_url)
           VALUES ($1, $2, $3, $4, 'PENDING', $5)`,
          [collector.school_id, collector.name, extraction.amount || 0, extraction.purpose || null, base64Image]
        );
        await sendTextMessage(
          inboundSchoolId,
          fromPhone,
          extraction.amount
            ? `Got it — petty cash expense of ₹${extraction.amount}${extraction.purpose ? ` for ${extraction.purpose}` : ''} logged. Waiting for approval.`
            : "Got the expense photo, but couldn't clearly read the amount — please tell the accountant to check and edit it before approving."
        );
        return res.sendStatus(200);
      }

      const extraction = await extractCashSlip(base64Image, mimeType || 'image/jpeg');

      await pool.query(
        `INSERT INTO whatsapp_cash_intake (school_id, fee_collector_id, photo_base64, ai_extracted_amount, ai_extracted_student_hint)
         VALUES ($1, $2, $3, $4, $5)`,
        [collector.school_id, collector.id, base64Image, extraction.amount, extraction.student_hint]
      );

      await sendTextMessage(
        inboundSchoolId,
        fromPhone,
        extraction.amount
          ? `Got it — ₹${extraction.amount}${extraction.student_hint ? ` for ${extraction.student_hint}` : ''}. Waiting for the accountant to confirm.`
          : "Got the photo, but couldn't clearly read the amount — the accountant will check it manually."
      );
      return res.sendStatus(200);
    }

    const complianceCheck = await pool.query(
      'SELECT id, school_id, opt_in_status FROM parents WHERE phone = ANY($1::text[]) AND school_id = $2',
      [fromCandidates, inboundSchoolId]
    );
    const parent = complianceCheck.rows[0];

    // Consent: "Anyone can reply STOP at any time" (feature guide, Trust).
    // Until now only admission enquiries honoured STOP — an existing
    // parent's STOP fell through to the parent assistant. Handle STOP /
    // START for this parent at THIS school (the one whose number they wrote
    // to) before anything else touches the message.
    if (parent && message.type === 'text' && message.text?.body) {
      const keyword = consentKeyword(message.text.body);
      if (keyword) {
        const newStatus = keyword === 'stop' ? 'OPTED_OUT' : 'OPTED_IN';
        const updated = await pool.query(
          `UPDATE parents SET opt_in_status = $1 WHERE phone = ANY($2::text[]) AND school_id = $3 RETURNING id, school_id`,
          [newStatus, fromCandidates, inboundSchoolId]
        );
        for (const row of updated.rows) {
          await audit({
            schoolId: row.school_id, actorType: 'parent', actorId: row.id,
            action: keyword === 'stop' ? 'parent.opted_out' : 'parent.opted_in',
            entityType: 'parent', entityId: row.id, detail: { via: 'whatsapp_keyword' },
          }).catch(() => {});
        }
        // One confirmation reply is allowed (they messaged us inside the 24h window).
        await sendTextMessage(inboundSchoolId, fromPhone, keyword === 'stop'
          ? 'You will no longer receive WhatsApp messages from the school. Reply START any time to turn them back on.'
          : 'WhatsApp messages from the school are turned back on. Reply STOP any time to turn them off.'
        ).catch((err) => console.error('[WhatsApp] consent confirmation failed:', err.message));
        return res.sendStatus(200);
      }
    }

    // Unknown number (not a parent, not a fee collector) sending text =
    // a prospective parent. Route it to the admission assistant instead
    // of dropping it. They wrote to us first, so replying within the 24h
    // window is allowed and they have consented to this conversation.
    if (!parent && message.type === 'text' && message.text?.body) {
      await handleEnquiryMessage({
        schoolId: inboundSchoolId,
        phone: normalizePhone(fromPhone) || `+${fromPhone}`,
        text: message.text.body,
        waMessageId: message.id,
      }).catch((err) => console.error('[WhatsApp] admission assistant error:', err.message));
      return res.sendStatus(200);
    }

    // A parent of a current student can also be a prospective parent (a
    // younger sibling) or be replying to an admission follow-up. Those
    // messages belong to the admission assistant, not to the parent
    // assistant / homework-doubt tutor below. They wrote to us first, so
    // answering is allowed whatever their opt-in for school alerts is.
    if (parent && message.type === 'text' && message.text?.body) {
      const enquiryRes = await pool.query(
        `SELECT id, phone, convo_state,
                COALESCE(last_inbound_at > NOW() - INTERVAL '30 minutes', FALSE) AS recent_inbound,
                COALESCE(last_outbound_at > NOW() - INTERVAL '2 hours', FALSE) AS recent_outbound
         FROM admission_enquiries
         WHERE school_id = $1 AND phone = ANY($2::text[]) AND stage NOT IN ('admitted', 'lost')
         ORDER BY updated_at DESC LIMIT 1`,
        [inboundSchoolId, fromCandidates]
      );
      const openEnquiry = enquiryRes.rows[0] || null;
      if (parentMessageIsForAdmissions({ text: message.text.body, enquiry: openEnquiry })) {
        await handleEnquiryMessage({
          schoolId: inboundSchoolId,
          phone: openEnquiry?.phone || normalizePhone(fromPhone) || `+${fromPhone}`,
          text: message.text.body,
          waMessageId: message.id,
        }).catch((err) => console.error('[WhatsApp] admission assistant error (known parent):', err.message));
        return res.sendStatus(200);
      }
    }

    // STRICT COMPLIANCE GATE at the query level, not just the UI.
    if (!parent || parent.opt_in_status !== 'OPTED_IN') {
      console.log(`[Compliance] Message ignored from ${fromPhone} — not OPTED_IN.`);
      return res.sendStatus(200);
    }

    // Any reply within the escalation window cancels the pending voice call —
    // this is the piece that lets the worker's DB check actually find something.
    const repliedRes = await pool.query(
      `UPDATE notification_log
       SET status = 'REPLIED', replied_at = CURRENT_TIMESTAMP
       WHERE parent_id = $1 AND status = 'SENT' AND replied_at IS NULL
       AND sent_at > NOW() - INTERVAL '24 hours'`,
      [parent.id]
    );

    // Phase 3: typed messages go through the parent assistant first (fees,
    // homework list, attendance, bus, leave, certificates, safety, ...).
    // Anything it doesn't recognise falls through to the doubt pipeline
    // below, exactly as before. Photos still go straight to the doubt flow.
    if (message.type === 'text' && message.text?.body) {
      const fullParent = await pool.query('SELECT id, school_id, name, phone, preferred_language FROM parents WHERE id = $1', [parent.id]);
      const outcome = await handleParentMessage({
        parent: fullParent.rows[0],
        text: message.text.body,
        waMessageId: message.id,
        repliedToAbsence: repliedRes.rowCount > 0,
      });
      if (outcome.handled) return res.sendStatus(200);
    }

    let userMessageText = '';
    if (message.type === 'text') {
      userMessageText = message.text.body;
    } else if (message.type === 'image') {
      // A parent/student photographed a homework question or textbook page.
      // Previously this was a hardcoded placeholder that silently dropped
      // the content — now Claude vision reads the actual question so it
      // flows into the same doubt-solving pipeline as a typed message.
      const { buffer, mimeType } = await downloadMedia(inboundSchoolId, message.image.id).catch(() => ({ buffer: null, mimeType: null }));
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

    // AI roadmap #2: tagDoubtChapter was always called with an empty
    // chapter list (see this function's own header comment — it
    // short-circuits to 'Untagged' whenever the list is empty), so every
    // doubt was tagged 'Untagged' before this. Fixed by actually looking
    // up the asking student's class and its currently-relevant syllabus
    // chapters.
    //
    // student_doubts already had an unused student_id column (never
    // populated by this route) — a parent can have more than one child,
    // and this webhook has no way to ask "which of your kids is this
    // about," so: if the parent has exactly one linked student, use that
    // student's class to scope both the chapter list AND student_id on
    // the row (fixing a second, related gap — doubts were never linkable
    // to a specific child at all). If the parent has multiple children,
    // student_id stays NULL and the chapter list stays empty (same
    // 'Untagged' behavior as before) rather than guessing which child.
    const studentRes = await pool.query(`SELECT id, class_id FROM students WHERE parent_id = $1`, [parent.id]);
    let studentId = null;
    let chapterNames = [];
    if (studentRes.rowCount === 1) {
      studentId = studentRes.rows[0].id;
      // "Currently relevant" = taught in the last 60 days or starting in
      // the next 14 — wide enough to catch a doubt about last week's
      // chapter without pulling in the whole year's syllabus.
      const chaptersRes = await pool.query(
        `SELECT DISTINCT chapter_name FROM syllabus_calendar
         WHERE class_id = $1
           AND target_end_date >= CURRENT_DATE - INTERVAL '60 days'
           AND target_start_date <= CURRENT_DATE + INTERVAL '14 days'
           AND chapter_name IS NOT NULL`,
        [studentRes.rows[0].class_id]
      );
      chapterNames = chaptersRes.rows.map((r) => r.chapter_name);
    }
    const chapterTag = await tagDoubtChapter(userMessageText, chapterNames);

    await pool.query(
      `INSERT INTO student_doubts (school_id, parent_id, student_id, original_query, ai_response_hint, chapter_tag)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [parent.school_id, parent.id, studentId, userMessageText, aiResponseHint, chapterTag]
    );

    await sendTextMessage(inboundSchoolId, fromPhone, aiResponseHint);

    res.sendStatus(200);
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    res.sendStatus(500);
  }
});


export default router;
