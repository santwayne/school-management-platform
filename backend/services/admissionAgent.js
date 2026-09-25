import axios from 'axios';
import pool from '../config/db.js';
import { sendTextMessage } from './whatsappService.js';
import { recordRun, raiseException, audit } from './opsService.js';

// ------------------------------------------------------------------
// Admission enquiry assistant (WhatsApp).
//
// Design rule: CODE owns the conversation, AI only understands it.
//  - Which question comes next, what the fee is, which visit slots are
//    free, and when a human is needed are all decided here, from SQL.
//  - Claude (when configured) only extracts fields / intent from what the
//    parent wrote, and may answer a general question strictly from the
//    school's own knowledge base. It never states a fee, date or seat.
//  - Without an API key the assistant still works: it asks one question
//    at a time and takes the reply as the answer to that question.
// ------------------------------------------------------------------

export const FIELD_ORDER = ['applying_grade', 'child_name', 'parent_name', 'locality', 'needs_transport'];

// ---------- Pure helpers (unit-tested) ----------

const WORD_NUMBERS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

// "Class 3", "3rd", "III", "third", "UKG", "Nursery", "Class 8A" → "3", "UKG", "NURSERY", "8"
export function gradeKey(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
  if (/\b(pre[\s-]?nursery|playgroup|play group|pg)\b/.test(t)) return 'PRE-NURSERY';
  if (/\bnursery\b/.test(t)) return 'NURSERY';
  if (/\blkg\b|\blower kg\b|\bkg[\s-]?1\b/.test(t)) return 'LKG';
  if (/\bukg\b|\bupper kg\b|\bkg[\s-]?2\b/.test(t)) return 'UKG';
  // Optional ordinal suffix and optional section letter: "3rd", "8A", "10 th".
  const num = t.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s?[a-f]?\b/);
  if (num) {
    const n = Number(num[1]);
    if (n >= 1 && n <= 12) return String(n);
  }
  for (const [w, n] of Object.entries(WORD_NUMBERS)) if (new RegExp(`\\b${w}\\b`).test(t)) return String(n);
  const roman = t.match(/\b(class|std|grade)?\s*(xii|xi|ix|x|viii|vii|vi|iv|v|iii|ii|i)\b/);
  if (roman && (roman[1] || t.trim() === roman[2])) return String(ROMAN[roman[2]]);
  return null;
}

export function detectLanguage(text) {
  const t = String(text || '');
  if (/[\u0A00-\u0A7F]/.test(t)) return 'pa';
  if (/[\u0900-\u097F]/.test(t)) return 'hi';
  if (/\b(hai|hain|kya|kitni|kitna|ji|bachha|bacha|beta|beti|chahiye|mera|meri|nahi|haan|karna|kaise|kab|aap)\b/i.test(t)) return 'hinglish';
  return 'en';
}

export function parseYesNo(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/^(y|yes|yeah|yep|haan|han|ha|ji|ji haan|haanji|hanji|chahiye|required|need|ok|sure)\b/.test(t) || /\bhaan\b|\byes\b|\bchahiye\b/.test(t)) {
    if (/\b(no|nahi|nahin|not|mat)\b/.test(t)) return false;
    return true;
  }
  if (/\b(no|nahi|nahin|nope|not required|nai|na)\b/.test(t)) return false;
  return null;
}

// Keyword intents that never need AI. Checked before anything else.
export function quickIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/^(stop|unsubscribe|band karo|mat bhejo|stop messages)$/.test(t)) return 'opt_out';
  if (/^(start|resume)$/.test(t)) return 'opt_in';
  if (/^[1-3]$/.test(t)) return 'choose_option';
  if (/\b(fee|fees|fess|kitni fee|charges|cost|kharcha|फीस)\b/.test(t)) return 'ask_fee';
  if (/\b(call me|talk to|baat karni|baat karo|human|person|manager|principal)\b/.test(t)) return 'wants_human';
  if (/\b(visit|dekhna|see the school|campus|tour|milna)\b/.test(t)) return 'book_visit';
  return null;
}

export function nextMissingField(e) {
  for (const f of FIELD_ORDER) {
    if (f === 'needs_transport' ? e.needs_transport === null || e.needs_transport === undefined : !e[f]) return f;
  }
  return null;
}

const Q = {
  en: {
    greet: (school) => `Thank you for your interest in ${school}! I'm the admissions assistant and can help with fees, a campus visit and the admission process.`,
    applying_grade: 'Which class are you looking for admission in?',
    child_name: "What is your child's name?",
    parent_name: 'And may I have your name?',
    locality: 'Which area do you live in?',
    needs_transport: 'Will your child need school transport? (yes / no)',
    offer: (list) => `Would you like to visit the campus? Reply with a number:\n${list}`,
    booked: (when) => `Your campus visit is booked for ${when}. We'll send a reminder. See you then!`,
    slot_full: 'Sorry, that slot just got full. Here are the next available times:',
    no_slots: 'Our admissions team will call you to fix a convenient visit time.',
    fee: (cls, amt) => `The annual fee for ${cls} is ${amt}.`,
    fee_range: (cls, lo, hi) => `The annual fee for ${cls} is between ${lo} and ${hi}, depending on the section.`,
    fee_unknown: "Our office will share the exact fee details with you shortly.",
    fee_need_class: 'Sure, I can tell you the fee. Which class is it for?',
    human: 'Of course. Someone from our admissions team will call you soon.',
    opted_out: "You won't receive any more admission messages from us. Reply START anytime to resume.",
    opted_in: "Welcome back! How can I help with admission?",
    closed: 'Admissions are closed at the moment. Our office will contact you when they reopen.',
    thanks_done: "Thank you! We have everything we need for now. Our team will be in touch.",
  },
  hinglish: {
    greet: (school) => `${school} mein interest ke liye dhanyavaad! Main admission assistant hoon. Fees, school visit aur admission process mein madad kar sakta hoon.`,
    applying_grade: 'Kaunsi class mein admission chahiye?',
    child_name: 'Bachhe ka naam kya hai?',
    parent_name: 'Aur aapka naam?',
    locality: 'Aap kis area mein rehte hain?',
    needs_transport: 'Kya bachhe ko school bus/van chahiye? (haan / nahi)',
    offer: (list) => `Kya aap school visit karna chahenge? Number reply karein:\n${list}`,
    booked: (when) => `Aapka school visit ${when} ke liye book ho gaya hai. Hum reminder bhejenge.`,
    slot_full: 'Maaf kijiye, woh slot abhi full ho gaya. Ye agle khali time hain:',
    no_slots: 'Hamari admission team aapko call karke visit ka time fix karegi.',
    fee: (cls, amt) => `${cls} ki saalana fee ${amt} hai.`,
    fee_range: (cls, lo, hi) => `${cls} ki saalana fee section ke hisaab se ${lo} se ${hi} ke beech hai.`,
    fee_unknown: 'Hamara office aapko exact fee details jaldi bhejega.',
    fee_need_class: 'Zaroor. Kaunsi class ke liye fee jaanni hai?',
    human: 'Bilkul. Hamari admission team jaldi aapko call karegi.',
    opted_out: 'Ab aapko admission ke messages nahi aayenge. Dobara shuru karne ke liye START likhein.',
    opted_in: 'Welcome back! Admission mein kaise madad karoon?',
    closed: 'Abhi admissions band hain. Khulne par office aapse sampark karega.',
    thanks_done: 'Dhanyavaad! Abhi ke liye saari jaankari mil gayi hai. Hamari team aapse sampark karegi.',
  },
  hi: {
    greet: (school) => `${school} में रुचि के लिए धन्यवाद! मैं एडमिशन सहायक हूँ। फीस, स्कूल विज़िट और एडमिशन में मदद कर सकता हूँ।`,
    applying_grade: 'किस कक्षा में एडमिशन चाहिए?',
    child_name: 'बच्चे का नाम क्या है?',
    parent_name: 'और आपका नाम?',
    locality: 'आप किस इलाके में रहते हैं?',
    needs_transport: 'क्या बच्चे को स्कूल बस/वैन चाहिए? (हाँ / नहीं)',
    offer: (list) => `क्या आप स्कूल देखने आना चाहेंगे? नंबर लिखकर जवाब दें:\n${list}`,
    booked: (when) => `आपकी स्कूल विज़िट ${when} के लिए बुक हो गई है। हम रिमाइंडर भेजेंगे।`,
    slot_full: 'माफ़ कीजिए, वह समय अभी भर गया। ये अगले खाली समय हैं:',
    no_slots: 'हमारी एडमिशन टीम आपको कॉल करके विज़िट का समय तय करेगी।',
    fee: (cls, amt) => `${cls} की सालाना फीस ${amt} है।`,
    fee_range: (cls, lo, hi) => `${cls} की सालाना फीस सेक्शन के अनुसार ${lo} से ${hi} के बीच है।`,
    fee_unknown: 'हमारा ऑफिस आपको फीस की पूरी जानकारी जल्द भेजेगा।',
    fee_need_class: 'ज़रूर। किस कक्षा की फीस जाननी है?',
    human: 'ज़रूर। हमारी एडमिशन टीम जल्द आपको कॉल करेगी।',
    opted_out: 'अब आपको एडमिशन के मैसेज नहीं आएँगे। दोबारा शुरू करने के लिए START लिखें।',
    opted_in: 'फिर से स्वागत है! एडमिशन में कैसे मदद करूँ?',
    closed: 'अभी एडमिशन बंद हैं। खुलने पर ऑफिस आपसे संपर्क करेगा।',
    thanks_done: 'धन्यवाद! अभी के लिए सारी जानकारी मिल गई है। हमारी टीम आपसे संपर्क करेगी।',
  },
};
// Punjabi (Gurmukhi) speakers get Hindi replies until Punjabi copy is added.
export function copyFor(lang) {
  return Q[lang] || (lang === 'pa' ? Q.hi : Q.en);
}

export const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export function formatSlot(slotStart, lang = 'en') {
  // slot_start is stored as IST wall-clock (timestamp without tz); format it as-is.
  const d = new Date(`${String(slotStart instanceof Date ? slotStart.toISOString() : slotStart).replace(' ', 'T').replace(/Z$/, '')}Z`);
  return d.toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function gradeLabel(key) {
  if (!key) return '';
  return /^\d+$/.test(key) ? `Class ${key}` : key === 'PRE-NURSERY' ? 'Pre-Nursery' : key === 'NURSERY' ? 'Nursery' : key;
}

// ---------- School attribution for unknown numbers ----------

export async function resolveSchoolForUnknownSender({ phoneNumberId, text }) {
  if (phoneNumberId) {
    const r = await pool.query('SELECT school_id FROM school_settings WHERE whatsapp_phone_number_id = $1', [phoneNumberId]);
    if (r.rowCount === 1) return r.rows[0].school_id;
  }
  const codes = await pool.query(
    `SELECT ss.school_id, UPPER(ss.admission_code) AS code FROM school_settings ss JOIN schools s ON s.id = ss.school_id
     WHERE s.status = 'active' AND ss.admission_code IS NOT NULL`
  );
  const upper = String(text || '').toUpperCase();
  const hit = codes.rows.find((c) => new RegExp(`\\b${c.code.replace(/[^A-Z0-9]/g, '')}\\b`).test(upper));
  if (hit) return hit.school_id;
  const active = await pool.query(`SELECT id FROM schools WHERE status = 'active'`);
  if (active.rowCount === 1) return active.rows[0].id;
  return null;
}

// ---------- Data helpers ----------

async function schoolContext(schoolId) {
  const [school, kb, settings] = await Promise.all([
    pool.query('SELECT name FROM schools WHERE id = $1', [schoolId]),
    pool.query(`SELECT topic, answer FROM school_knowledge_base WHERE school_id = $1 AND audience IN ('enquiry', 'all')`, [schoolId]),
    pool.query('SELECT COALESCE(admissions_open, TRUE) AS open FROM school_settings WHERE school_id = $1', [schoolId]),
  ]);
  return { name: school.rows[0]?.name || 'our school', kb: kb.rows, admissionsOpen: settings.rows[0]?.open ?? true };
}

export async function feeForGrade(schoolId, grade) {
  if (!grade) return null;
  const r = await pool.query(
    `SELECT c.name, fs.amount FROM classes c JOIN fee_structures fs ON fs.class_id = c.id AND fs.school_id = c.school_id
     WHERE c.school_id = $1 AND fs.amount > 0`,
    [schoolId]
  );
  const amounts = r.rows.filter((row) => gradeKey(row.name) === grade).map((row) => Number(row.amount));
  if (amounts.length === 0) return null;
  return { min: Math.min(...amounts), max: Math.max(...amounts) };
}

export async function classesForGrade(schoolId, grade) {
  const r = await pool.query('SELECT id, name, section FROM classes WHERE school_id = $1 ORDER BY name, section', [schoolId]);
  return r.rows.filter((c) => gradeKey(c.name) === grade);
}

async function freeSlots(schoolId, limit = 3, excludeIds = []) {
  const r = await pool.query(
    `SELECT id, slot_start FROM campus_visit_slots
     WHERE school_id = $1 AND booked < capacity
       AND slot_start > (NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '2 hours'
       AND NOT (id = ANY($3::int[]))
     ORDER BY slot_start LIMIT $2`,
    [schoolId, limit, excludeIds]
  );
  return r.rows;
}

// Atomic seat-taking: the WHERE booked < capacity guard plus the partial
// unique index on campus_visits(enquiry_id) make double-booking impossible
// even with two concurrent messages.
export async function bookSlot(enquiry, slotId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taken = await client.query(
      `UPDATE campus_visit_slots SET booked = booked + 1 WHERE id = $1 AND school_id = $2 AND booked < capacity RETURNING id, slot_start`,
      [slotId, enquiry.school_id]
    );
    if (taken.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    // Rebooking: release the previous seat.
    const prev = await client.query(
      `UPDATE campus_visits SET status = 'cancelled' WHERE enquiry_id = $1 AND status = 'booked' RETURNING slot_id`,
      [enquiry.id]
    );
    for (const p of prev.rows) await client.query('UPDATE campus_visit_slots SET booked = GREATEST(booked - 1, 0) WHERE id = $1', [p.slot_id]);
    await client.query('INSERT INTO campus_visits (school_id, enquiry_id, slot_id) VALUES ($1, $2, $3)', [enquiry.school_id, enquiry.id, slotId]);
    await client.query(`UPDATE admission_enquiries SET stage = 'visit_booked', updated_at = NOW() WHERE id = $1`, [enquiry.id]);
    await client.query('COMMIT');
    return taken.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function logMessage(enquiry, direction, body, { sentBy = 'ai', waMessageId = null, templateName = null } = {}) {
  const r = await pool.query(
    `INSERT INTO enquiry_messages (school_id, enquiry_id, direction, body, sent_by, wa_message_id, template_name, delivery_status)
     VALUES ($1, $2, $3::varchar, $4, $5, $6, $7, CASE WHEN $3::varchar = 'in' THEN 'received' ELSE 'sent' END)
     ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [enquiry.school_id, enquiry.id, direction, body, sentBy, waMessageId, templateName]
  );
  return r.rowCount > 0;
}

// Never throws: a failed send is recorded on the message and raised to the
// operator, and the conversation state (already saved) is kept.
export async function sendEnquiryText(enquiry, body, { sentBy = 'ai' } = {}) {
  const to = enquiry.phone.replace(/^\+/, '');
  let ok = true;
  let errMsg = null;
  try {
    await sendTextMessage(to, body);
  } catch (err) {
    ok = false;
    errMsg = err.response?.data?.error?.message || err.message;
    console.error(`[admissions] WhatsApp send failed for enquiry ${enquiry.id}:`, errMsg);
  }
  await pool.query(
    `INSERT INTO enquiry_messages (school_id, enquiry_id, direction, body, sent_by, delivery_status) VALUES ($1, $2, 'out', $3, $4, $5)`,
    [enquiry.school_id, enquiry.id, body, sentBy, ok ? 'sent' : 'failed']
  );
  if (ok) {
    await pool.query('UPDATE admission_enquiries SET last_outbound_at = NOW() WHERE id = $1', [enquiry.id]);
  } else {
    await raiseException({
      schoolId: enquiry.school_id,
      source: 'admission',
      severity: 'high',
      title: `Reply to admission enquiry not delivered (${enquiry.parent_name || enquiry.phone})`,
      body: `WhatsApp error: ${errMsg}\n\nThe parent is waiting for a reply. Call ${enquiry.phone} or retry from the enquiry screen.`,
      entityType: 'enquiry',
      entityId: enquiry.id,
      dedupeKey: `admission_send_failed:${enquiry.id}`,
    });
  }
  return ok;
}

async function getOrCreateEnquiry({ schoolId, phone, source }) {
  const existing = await pool.query(
    `SELECT * FROM admission_enquiries WHERE school_id = $1 AND phone = $2 AND stage NOT IN ('admitted', 'lost')`,
    [schoolId, phone]
  );
  if (existing.rowCount) return { enquiry: existing.rows[0], created: false };
  const r = await pool.query(
    `INSERT INTO admission_enquiries (school_id, source, phone, whatsapp_consent, consent_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN NOW() END)
     ON CONFLICT (school_id, phone) WHERE stage NOT IN ('admitted', 'lost') DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [schoolId, source, phone, source === 'whatsapp']
  );
  return { enquiry: r.rows[0], created: true };
}

// ---------- Optional AI understanding ----------

async function aiUnderstand({ text, enquiry, awaiting, kb, lang }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const known = Object.fromEntries(FIELD_ORDER.map((f) => [f, enquiry[f] ?? null]));
  const system = [
    'You read one WhatsApp message from a parent enquiring about school admission and return JSON only.',
    'Extract only what the message clearly states. Never guess.',
    'Fields: applying_class (as written, e.g. "3rd", "UKG"), child_name, parent_name, locality, needs_transport (true/false), child_dob (YYYY-MM-DD).',
    'intent: one of provide_info | ask_fee | book_visit | ask_question | wants_human | complaint | not_interested | greeting | other.',
    'If intent is ask_question, answer ONLY from the knowledge base below, in the same language/script as the parent, in at most 2 short sentences. If the knowledge base does not contain the answer, set faq_answer to null. Never state fees, dates or seat availability.',
    `The assistant last asked for: ${awaiting || 'nothing'}. A short reply (like a name or "3rd") is probably the answer to that.`,
    `Already known: ${JSON.stringify(known)}`,
    `Knowledge base: ${JSON.stringify(kb)}`,
    'Output: {"extracted":{...only present fields...},"intent":"...","faq_answer":null|"...","needs_human":false,"reason":null|"..."}',
  ].join('\n');
  try {
    const r = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-sonnet-5', max_tokens: 400, system, messages: [{ role: 'user', content: text }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 20000 }
    );
    const raw = r.data?.content?.find((b) => b.type === 'text')?.text || '';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (err) {
    console.error('[admissions] AI understanding failed, using rule-based fallback:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

// Rule-based extraction: treat the reply as the answer to the question
// that was just asked, with light validation per field.
export function ruleExtract(text, awaiting) {
  const t = String(text || '').trim();
  const out = {};
  const grade = gradeKey(t);
  if (grade && (awaiting === 'applying_grade' || /\b(class|admission|std|grade|nursery|kg)\b/i.test(t) || /(कक्षा|क्लास|एडमिशन|ਜਮਾਤ|ਕਲਾਸ|ਦਾਖਲਾ)/.test(t))) {
    out.applying_class = t;
  }
  if (!awaiting || t.length > 80) return out;
  if (awaiting === 'child_name' || awaiting === 'parent_name') {
    const name = t.replace(/^(my name is|name is|naam|mera naam|uska naam|his name is|her name is)\s*/i, '').replace(/\s+(hai|he|h)$/i, '').trim();
    if (name && name.split(/\s+/).length <= 4 && !/[\d?]/.test(name) && !quickIntent(name)) out[awaiting] = name.replace(/\b\w/g, (c) => c.toUpperCase());
  } else if (awaiting === 'locality') {
    if (t.length >= 2) out.locality = t;
  } else if (awaiting === 'needs_transport') {
    const yn = parseYesNo(t);
    if (yn !== null) out.needs_transport = yn;
  }
  return out;
}

// ---------- Main entry point ----------

export async function handleEnquiryMessage({ schoolId, phone, text, waMessageId, source = 'whatsapp' }) {
  const startedAt = new Date();
  try {
    const { enquiry, created } = await getOrCreateEnquiry({ schoolId, phone, source });
    const fresh = await logMessage(enquiry, 'in', text, { sentBy: 'parent', waMessageId });
    if (!fresh) return { duplicate: true }; // Meta webhook retry

    await pool.query(
      `UPDATE admission_enquiries SET last_inbound_at = NOW(), updated_at = NOW(),
              stage = CASE WHEN stage = 'new' THEN 'qualifying' ELSE stage END,
              next_followup_at = CASE WHEN stage IN ('new', 'qualifying', 'qualified') THEN NOW() + INTERVAL '1 day' ELSE next_followup_at END,
              followup_count = 0
       WHERE id = $1`,
      [enquiry.id]
    );

    const lang = detectLanguage(text);
    const c = copyFor(enquiry.convo_state?.lang && lang === 'en' ? enquiry.convo_state.lang : lang);
    const state = { ...(enquiry.convo_state || {}), lang: lang === 'en' && enquiry.convo_state?.lang ? enquiry.convo_state.lang : lang };
    const ctx = await schoolContext(schoolId);
    const replies = [];

    const q = quickIntent(text);
    if (q === 'opt_out') {
      await pool.query(`UPDATE admission_enquiries SET opted_out = TRUE, next_followup_at = NULL WHERE id = $1`, [enquiry.id]);
      await sendEnquiryText(enquiry, c.opted_out, { sentBy: 'system' });
      await audit({ schoolId, action: 'admission.opted_out', entityType: 'enquiry', entityId: enquiry.id });
      return { optedOut: true };
    }
    if (enquiry.opted_out && q !== 'opt_in') return { ignored: 'opted_out' };
    if (q === 'opt_in') {
      await pool.query(`UPDATE admission_enquiries SET opted_out = FALSE WHERE id = $1`, [enquiry.id]);
      enquiry.opted_out = false;
      replies.push(c.opted_in);
    }

    // Operator took over this chat: store the message, don't auto-reply.
    if (enquiry.ai_paused_until && new Date(enquiry.ai_paused_until) > new Date()) {
      await raiseException({
        schoolId,
        source: 'admission',
        severity: 'medium',
        title: `New message in admission chat you took over (${enquiry.parent_name || enquiry.phone})`,
        body: `Message: "${String(text).slice(0, 300)}"`,
        entityType: 'enquiry',
        entityId: enquiry.id,
        dedupeKey: `admission_takeover:${enquiry.id}`,
      });
      return { paused: true };
    }

    if (!ctx.admissionsOpen) {
      await sendEnquiryText(enquiry, c.closed, { sentBy: 'system' });
      return { closed: true };
    }

    if (created) replies.push(c.greet(ctx.name));

    // Understand the message.
    const ai = q && q !== 'choose_option' ? null : await aiUnderstand({ text, enquiry, awaiting: state.awaiting, kb: ctx.kb, lang });
    const intent = ai?.intent || q || 'provide_info';
    // A question or request ("fee kitni hai?") is not the answer to the
    // pending question — don't let it become the child's name.
    const isSideQuestion = (q && q !== 'choose_option') || /\?$/.test(String(text).trim());
    const extracted = { ...ruleExtract(text, isSideQuestion ? null : state.awaiting), ...(ai?.extracted || {}) };

    // Merge extracted fields (only fill blanks or answer the pending question).
    const updates = {};
    if (extracted.applying_class) {
      const g = gradeKey(extracted.applying_class);
      if (g) {
        updates.applying_class_text = String(extracted.applying_class).slice(0, 50);
        updates.applying_grade = g;
      }
    }
    for (const f of ['child_name', 'parent_name', 'locality']) {
      if (extracted[f] && (!enquiry[f] || state.awaiting === f)) updates[f] = String(extracted[f]).slice(0, 150);
    }
    if (typeof extracted.needs_transport === 'boolean') updates.needs_transport = extracted.needs_transport;
    if (extracted.child_dob && /^\d{4}-\d{2}-\d{2}$/.test(extracted.child_dob)) updates.child_dob = extracted.child_dob;
    if (Object.keys(updates).length) {
      const keys = Object.keys(updates);
      await pool.query(
        `UPDATE admission_enquiries SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
        [enquiry.id, ...keys.map((k) => updates[k])]
      );
      Object.assign(enquiry, updates);
    }

    // Slot choice ("1", "2", "3") after we offered times.
    if (q === 'choose_option' && Array.isArray(state.offered_slot_ids) && state.offered_slot_ids.length) {
      const idx = Number(text.trim()) - 1;
      const slotId = state.offered_slot_ids[idx];
      if (slotId) {
        const booked = await bookSlot(enquiry, slotId);
        if (booked) {
          replies.push(c.booked(formatSlot(booked.slot_start, state.lang)));
          state.offered_slot_ids = [];
          state.awaiting = null;
          await audit({ schoolId, action: 'admission.visit_booked', entityType: 'enquiry', entityId: enquiry.id, detail: { slot_id: slotId } });
        } else {
          const alt = await freeSlots(schoolId, 3, [slotId]);
          if (alt.length) {
            state.offered_slot_ids = alt.map((s) => s.id);
            replies.push(`${c.slot_full}\n${alt.map((s, i) => `${i + 1}. ${formatSlot(s.slot_start, state.lang)}`).join('\n')}`);
          } else {
            replies.push(c.no_slots);
            await raiseNoSlots(schoolId, enquiry);
          }
        }
      }
    }

    // Intent-specific answers.
    if (intent === 'ask_fee') {
      if (!enquiry.applying_grade) {
        replies.push(c.fee_need_class);
        state.awaiting = 'applying_grade';
      } else {
        const fee = await feeForGrade(schoolId, enquiry.applying_grade);
        const label = gradeLabel(enquiry.applying_grade);
        if (!fee) {
          replies.push(c.fee_unknown);
          await raiseException({
            schoolId,
            source: 'admission',
            severity: 'low',
            title: `Fee not set up for ${label}: parent is asking`,
            body: `An admission enquiry (${enquiry.parent_name || enquiry.phone}) asked for the ${label} fee, but no fee is configured for that class. Add it under Fees → Fee structure so the assistant can answer, and share it with this parent.`,
            entityType: 'enquiry',
            entityId: enquiry.id,
            dedupeKey: `fee_missing:${enquiry.applying_grade}`,
          });
        } else {
          replies.push(fee.min === fee.max ? c.fee(label, inr(fee.min)) : c.fee_range(label, inr(fee.min), inr(fee.max)));
        }
      }
    } else if (intent === 'ask_question') {
      if (ai?.faq_answer) replies.push(ai.faq_answer);
      else {
        replies.push(c.human);
        await raiseException({
          schoolId,
          source: 'admission',
          severity: 'medium',
          title: `Admission question the assistant couldn't answer (${enquiry.parent_name || enquiry.phone})`,
          body: `Question: "${String(text).slice(0, 300)}"\n\nReply from the enquiry screen, and consider adding the answer to the school knowledge base so the assistant can answer it next time.`,
          entityType: 'enquiry',
          entityId: enquiry.id,
          dedupeKey: `admission_question:${enquiry.id}`,
        });
      }
    } else if (intent === 'wants_human' || intent === 'complaint' || ai?.needs_human) {
      replies.push(c.human);
      await raiseException({
        schoolId,
        source: 'admission',
        severity: intent === 'complaint' ? 'high' : 'medium',
        title: `${intent === 'complaint' ? 'Unhappy' : 'Call back'}: admission enquiry from ${enquiry.parent_name || enquiry.phone}`,
        body: `Message: "${String(text).slice(0, 300)}"${ai?.reason ? `\n\nWhy: ${ai.reason}` : ''}\n\nCall ${enquiry.phone}.`,
        entityType: 'enquiry',
        entityId: enquiry.id,
        suggestedAction: { label: 'Pause assistant for 24 h', action: 'admission.pause_ai', params: { enquiry_id: enquiry.id, hours: 24 } },
        dedupeKey: `admission_callback:${enquiry.id}`,
      });
    } else if (intent === 'not_interested') {
      await pool.query(`UPDATE admission_enquiries SET stage = 'lost', lost_reason = 'not_interested', next_followup_at = NULL WHERE id = $1`, [enquiry.id]);
      await audit({ schoolId, action: 'admission.lost', entityType: 'enquiry', entityId: enquiry.id, detail: { reason: 'not_interested' } });
      return { lost: true };
    }

    // Keep the conversation moving: next missing field, else offer a visit.
    const hasVisit = (await pool.query(`SELECT 1 FROM campus_visits WHERE enquiry_id = $1 AND status = 'booked'`, [enquiry.id])).rowCount > 0;
    const missing = nextMissingField(enquiry);
    const alreadyAskedSomething = replies.some((r) => r === c.fee_need_class);
    if (missing && !alreadyAskedSomething) {
      replies.push(c[missing]);
      state.awaiting = missing;
    } else if (!missing) {
      if (enquiry.stage === 'qualifying') await pool.query(`UPDATE admission_enquiries SET stage = 'qualified' WHERE id = $1 AND stage = 'qualifying'`, [enquiry.id]);
      state.awaiting = null;
      if (!hasVisit && !(state.offered_slot_ids || []).length && intent !== 'ask_question') {
        const slots = await freeSlots(schoolId);
        if (slots.length) {
          state.offered_slot_ids = slots.map((s) => s.id);
          replies.push(c.offer(slots.map((s, i) => `${i + 1}. ${formatSlot(s.slot_start, state.lang)}`).join('\n')));
        } else {
          replies.push(c.no_slots);
          await raiseNoSlots(schoolId, enquiry);
        }
      } else if (replies.length === 0) {
        replies.push(c.thanks_done);
      }
    }

    await pool.query('UPDATE admission_enquiries SET convo_state = $2 WHERE id = $1', [enquiry.id, JSON.stringify(state)]);

    const reply = replies.filter(Boolean).join('\n\n');
    if (reply) await sendEnquiryText(enquiry, reply);
    await recordRun({ key: 'admission_assistant', schoolId, status: 'success', startedAt, itemsTotal: 1, itemsSucceeded: 1 });
    return { enquiryId: enquiry.id, reply, intent, used_ai: !!ai };
  } catch (err) {
    console.error('[admissions] handleEnquiryMessage failed:', err.stack || err.message);
    await recordRun({ key: 'admission_assistant', schoolId, status: 'failed', startedAt, itemsTotal: 1, itemsFailed: 1, errorSummary: err.message });
    await raiseException({
      schoolId,
      source: 'admission',
      severity: 'high',
      title: `Admission enquiry could not be answered (${phone})`,
      body: `The assistant failed while replying: ${err.message}\n\nParent's message: "${String(text).slice(0, 300)}". Please reply to them from the enquiry screen.`,
      dedupeKey: `admission_fail:${phone}`,
    });
    throw err;
  }
}

async function raiseNoSlots(schoolId, enquiry) {
  await raiseException({
    schoolId,
    source: 'admission',
    severity: 'high',
    title: 'No campus visit slots available: parents are waiting',
    body: `An admission enquiry (${enquiry.parent_name || enquiry.phone}) is ready to book a visit, but there are no free visit slots. Add slots under Admissions → Visit slots; the assistant will offer them automatically.`,
    entityType: 'enquiry',
    entityId: enquiry.id,
    dedupeKey: 'admission_no_slots',
  });
}
