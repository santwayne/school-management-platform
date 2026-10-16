import pool from '../config/db.js';
import { sendTextMessage, downloadMedia } from './whatsappService.js';
import { createHomework, homeworkOptions, shareHomework, HomeworkError } from './homeworkService.js';
import { shareLessonPlan } from './lessonPlanService.js';
import { storeTeachingMedia, MediaError, TEACHING_MEDIA_TYPES } from './teachingMedia.js';
import { parseTeacherCommand, matchClassSubject } from '../utils/teacherCommand.js';
import { AssistantError, chat, decideAction } from './assistantService.js';

const HELP =
  'To create homework or a lesson plan, send:\n' +
  'HOMEWORK 7A Maths: Chapter 4 exercises\nSolve Q1-10\ndue 20/10/2026\n\n' +
  'or LESSON PLAN 7A Maths: Fractions intro\n\n' +
  'Attach a photo or document with the message to include it. ' +
  'Then reply SHARE HW <number> or SHARE LP <number> to send it to the class (this can be done once).';

// Teachers can create homework / lesson plans and share them from WhatsApp.
// Returns true when the sender is a registered teacher/principal number and
// the message was handled (the webhook then stops); false lets the normal
// parent/collector flow continue. Nothing here sends to a class until the
// teacher explicitly replies SHARE — drafts are saved first.
export async function handleTeacherMessage({ schoolId, fromCandidates, fromPhone, message }) {
  const t = await pool.query(
    `SELECT id, name, role FROM teachers
      WHERE school_id = $1 AND whatsapp_number = ANY($2::text[]) AND role IN ('teacher', 'principal', 'operator') LIMIT 1`,
    [schoolId, fromCandidates]
  );
  if (!t.rowCount) return handleDigestApproval({ schoolId, fromCandidates, fromPhone, message });
  const teacher = t.rows[0];
  const user = { school_id: schoolId, role: teacher.role, teacher_id: teacher.id };

  const text = message.type === 'text' ? message.text?.body : message[message.type]?.caption;
  const command = teacher.role === 'operator' ? null : parseTeacherCommand(text);

  // Principal / operator: anything that is not a homework command is a
  // conversation with the school's AI assistant (same one as Control Center →
  // Ask AI). Approvals are done by replying APPROVE <n> / NO <n>.
  if (!command && ['principal', 'operator'].includes(teacher.role)) {
    if (message.type !== 'text' || !text?.trim()) {
      await sendTextMessage(schoolId, fromPhone, 'Send me a text message — ask about any record, or ask me to draft something.').catch(() => {});
      return true;
    }
    await handleAssistantMessage({ schoolId, fromPhone, user, text: text.trim() });
    return true;
  }
  // Not for us (e.g. a staff member who is also a parent) — fall through.
  if (!command) return false;

  const reply = (body) => sendTextMessage(schoolId, fromPhone, body).catch((e) => console.error('[teacherWhatsapp] reply failed:', e.message));

  try {
    if (command.type === 'share') {
      if (command.kind === 'homework') {
        await shareHomework(user, command.id);
        await reply(`Homework #${command.id} is being sent to the class.`);
      } else {
        const out = await shareLessonPlan(user, command.id);
        await reply(out.status === 200 ? `Lesson plan #${command.id} is being sent to the class.` : out.body.error);
      }
      return true;
    }

    if (command.error === 'missing_title') return (await reply(`Please add a title after a colon.\n\n${HELP}`), true);
    if (command.error === 'bad_due') return (await reply('I could not read the due date — use due 2026-10-20 or due 20/10/2026.'), true);

    const options = await homeworkOptions(user);
    const match = matchClassSubject(command.header, options);
    if (!match) {
      const list = options.slice(0, 8).map((o) => `${o.class_name} ${o.subject_name}`).join(', ');
      await reply(`I could not tell which class and subject you meant. Try e.g. "${command.kind === 'homework' ? 'HOMEWORK' : 'LESSON PLAN'} ${options[0]?.class_name || '7A'} ${options[0]?.subject_name || 'Maths'}: title". You teach: ${list || 'no classes yet'}.`);
      return true;
    }

    let attachment = null;
    const media = message.type === 'image' || message.type === 'document' ? message[message.type] : null;
    if (media) {
      const { buffer, mimeType } = await downloadMedia(schoolId, media.id).catch(() => ({ buffer: null }));
      const mime = media.mime_type || mimeType;
      if (!buffer || !TEACHING_MEDIA_TYPES[mime]) {
        await reply('I could not use that attachment (send a JPG, PNG, PDF, Word, PowerPoint or Excel file). Nothing was saved.');
        return true;
      }
      attachment = await storeTeachingMedia({ schoolId, buffer: Buffer.from(buffer), mimeType: mime, originalName: media.filename || 'attachment' });
    }

    if (command.kind === 'homework') {
      const hw = await createHomework(user, {
        class_id: match.class_id,
        subject_id: match.subject_id,
        title: command.title,
        description: command.details,
        due_date: command.dueDate,
        attachment_url: attachment?.url,
        attachment_name: attachment?.name,
        source: 'whatsapp',
      });
      await reply(`Homework saved for ${match.class_name} ${match.subject_name}: "${hw.title}"${attachment ? ' with your attachment' : ''}.\nReply SHARE HW ${hw.id} to send it to the class (can be done once).`);
    } else {
      const { rows } = await pool.query(
        `INSERT INTO lesson_plans (school_id, class_id, subject_id, teacher_id, title, content, attachment_url, attachment_name, plan_date, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'whatsapp') RETURNING id, title`,
        [schoolId, match.class_id, match.subject_id, teacher.id, command.title.slice(0, 255), command.details || null, attachment?.url || null, attachment?.name || null, command.dueDate]
      );
      await reply(`Lesson plan saved for ${match.class_name} ${match.subject_name}: "${rows[0].title}"${attachment ? ' with your attachment' : ''}.\nReply SHARE LP ${rows[0].id} to send it to the class (can be done once).`);
    }
  } catch (err) {
    if (err instanceof HomeworkError || err instanceof MediaError) await reply(err.message);
    else {
      console.error('[teacherWhatsapp] failed:', err);
      await reply('Sorry, something went wrong and nothing was saved. Please try again or use the Teacher Portal.');
    }
  }
  return true;
}

// The morning plan goes to the numbers in Control Center → Daily report, which
// need not be saved on a staff record. An APPROVE n / NO n reply from such a
// number is accepted and recorded against that school's principal (operator
// number → an operator account if one exists). Only approve/reject replies are
// handled here; anything else falls through to the normal flow, so this does
// not open Ask AI to the number.
export const APPROVAL_REPLY_RE = /^\s*(approve|yes|reject|no)\s+#?(\d+)\s*$/i;

async function handleDigestApproval({ schoolId, fromCandidates, fromPhone, message }) {
  const text = message.type === 'text' ? message.text?.body : null;
  if (!text || !APPROVAL_REPLY_RE.test(text)) return false;
  const s = await pool.query(
    `SELECT CASE WHEN principal_digest_phone = ANY($2::text[]) THEN 'principal'
                 WHEN operator_digest_phone = ANY($2::text[]) THEN 'operator' END AS role
       FROM school_settings WHERE school_id = $1`,
    [schoolId, fromCandidates]
  );
  const role = s.rows[0]?.role;
  if (!role) return false;
  const acct = await pool.query(
    `SELECT id, role FROM teachers WHERE school_id = $1 AND role IN ('principal', 'operator')
      ORDER BY (role = $2) DESC, id LIMIT 1`,
    [schoolId, role]
  );
  if (!acct.rowCount) return false;
  const user = { school_id: schoolId, role: acct.rows[0].role, teacher_id: acct.rows[0].id };
  await handleAssistantMessage({ schoolId, fromPhone, user, text: text.trim() });
  return true;
}

// ---------- Principal / operator ↔ AI assistant on WhatsApp ----------

// WhatsApp text: **bold** -> *bold*, split into <= 4000 character messages.
export function toWhatsAppText(text) {
  const t = String(text).replace(/\*\*([^*]+)\*\*/g, '*$1*').replace(/^#{1,6}\s+/gm, '');
  const chunks = [];
  let rest = t;
  while (rest.length > 4000) {
    const cut = rest.lastIndexOf('\n', 4000) > 2000 ? rest.lastIndexOf('\n', 4000) : 4000;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function handleAssistantMessage({ schoolId, fromPhone, user, text }) {
  const send = async (body) => {
    for (const part of toWhatsAppText(body)) await sendTextMessage(schoolId, fromPhone, part).catch((e) => console.error('[assistant whatsapp] send failed:', e.message));
  };
  try {
    const decision = APPROVAL_REPLY_RE.exec(text);
    if (decision) {
      const approve = /^(approve|yes)$/i.test(decision[1]);
      const out = await decideAction({ user, actionId: Number(decision[2]), approve });
      return send(approve ? `Approved #${decision[2]}. ${out.result ? `Result: ${out.result}` : 'Done.'}`.trim() : `Okay, #${decision[2]} cancelled.`);
    }
    // Continue today's WhatsApp conversation if there is a recent one.
    const recent = await pool.query(
      `SELECT id FROM assistant_conversations WHERE school_id = $1 AND user_id = $2 AND title LIKE 'WhatsApp:%' AND updated_at > NOW() - INTERVAL '4 hours' ORDER BY updated_at DESC LIMIT 1`,
      [schoolId, user.teacher_id]
    );
    const r = await chat({ user, conversationId: recent.rows[0]?.id, message: text, channel: 'whatsapp' });
    let out = r.reply;
    for (const d of r.documents) out += `\n\nDocument ready: "${d.title}". Open Control Center → Ask AI to download the PDF.`;
    for (const a of r.actions) out += `\n\nNeeds your OK: ${a.summary}\nReply APPROVE ${a.id} or NO ${a.id}.`;
    await send(out);
  } catch (err) {
    if (err instanceof AssistantError) return send(err.message);
    console.error('[assistant whatsapp] failed:', err);
    await send('Sorry, I hit a problem answering that. Please try again in a moment.');
  }
}
