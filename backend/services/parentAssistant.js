import axios from 'axios';
import pool from '../config/db.js';
import { sendTextMessage } from './whatsappService.js';
import { recordRun, raiseException, audit } from './opsService.js';
import { detectLanguage, inr } from './admissionAgent.js';
import { haversineMeters } from './busProximityService.js';
import { createPaymentLinkRecord } from '../routes/paymentLinks.js';

// ------------------------------------------------------------------
// Parent WhatsApp assistant.
//
// Every reply is built from SQL rows scoped to THIS parent's own children.
// Nothing about another family can ever be read: every handler query is
// keyed by a student_id that came from `students WHERE parent_id = $1`.
//
// Intent comes from keywords first (fast, free, predictable). Claude is used
// only when keywords don't match and a key is configured, and only to pick
// an intent label. Unmatched messages fall through to the existing homework
// doubt pipeline, so current behaviour is the floor, not lost.
//
// Safety: anything that sounds like bullying, violence, abuse or a child
// being unsafe is never "handled" by the assistant. It acknowledges, and a
// critical inbox item goes to the operator/principal immediately.
// ------------------------------------------------------------------

export const INTENTS = [
  'safety', 'fee_balance', 'pay_now', 'fee_receipt', 'homework_today', 'attendance', 'results', 'leave_request',
  'holidays_events', 'bus_location', 'timetable', 'certificate_request', 'talk_to_teacher', 'complaint', 'menu', 'thanks',
];

// Order matters: first match wins. Safety is always checked first.
const KEYWORDS = [
  ['safety', /\b(bully|bullying|bullied|ragging|maara|mara|maarta|peeta|pitai|beat|beaten|hit him|hit her|abuse|abused|harass|harassment|touched|unsafe|threat|dhamki|injured|chot lagi|khoon)\b|मारा|पीटा|धमकी/i],
  ['pay_now', /\b(pay now|payment link|pay karna|pay kar|link bhejo|online pay|bhugtan)\b/i],
  ['fee_receipt', /\b(receipt|raseed|rasid)\b/i],
  ['fee_balance', /\b(fee|fees|fess|baaki|bakaya|balance|due|dues|pending amount)\b|फीस/i],
  ['homework_today', /\b(homework|home work|hw|grih ?karya|aaj ka kaam)\b|होमवर्क|गृहकार्य/i],
  ['results', /\b(result|results|marks|report card|number kitne|grade card)\b/i],
  ['attendance', /\b(attendance|haaziri|hazri|kitne din absent|present tha|present thi)\b|हाज़िरी/i],
  ['leave_request', /\b(leave|nahi aayega|nahi aayegi|nahi aaega|nahi aaegi|absent rahega|absent rahegi|chutti chahiye|chhutti chahiye|chutti leni|school nahi aa)\b/i],
  ['bus_location', /\b(bus|van)\b.*\b(kahan|kaha|where|location|kab|late|aayi|aai|pahunchi)\b|\b(where is the bus|bus location)\b|बस कहाँ/i],
  ['holidays_events', /\b(holiday|holidays|chutti|chhutti|event|events|ptm|function|annual day|exam date|exams kab|datesheet|date sheet)\b|छुट्टी/i],
  ['timetable', /\b(time ?table|kal kya|periods|schedule)\b/i],
  ['certificate_request', /\b(certificate|bonafide|bonafied|character certificate|transfer certificate|leaving certificate|\btc\b|id card)\b/i],
  ['talk_to_teacher', /\b(teacher se baat|class teacher|call teacher|meet teacher|teacher ko bolo|teacher se milna|talk to (the )?teacher)\b/i],
  ['complaint', /\b(complaint|shikayat|not happy|unhappy|problem with|badtameezi|rude)\b|शिकायत/i],
  ['menu', /^(menu|help|options|madad|\?)$/i],
  ['thanks', /^(thanks|thank you|thank u|ok|okay|theek hai|thik hai|shukriya|dhanyavaad|👍|🙏)[.! ]*$/i],
];

export function keywordIntent(text) {
  const t = String(text || '').trim();
  for (const [intent, re] of KEYWORDS) if (re.test(t)) return intent;
  return null;
}

// "aaj"/"today" → today, "kal"/"tomorrow" → tomorrow (in a leave request
// "kal" means tomorrow), "parso" → +2, "28/9" or "28-09" → that date this
// year (next year if already past). Dates are IST calendar dates.
export function parseLeaveDates(text, todayIso) {
  const t = String(text || '').toLowerCase();
  const today = new Date(`${todayIso}T00:00:00Z`);
  const add = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
  const explicit = [...t.matchAll(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g)].map((m) => {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : today.getUTCFullYear();
    let d = new Date(Date.UTC(year, month - 1, day));
    if (!m[3] && d < today) d = new Date(Date.UTC(year + 1, month - 1, day));
    return d.toISOString().slice(0, 10);
  }).filter(Boolean);
  if (explicit.length) {
    const sorted = explicit.sort();
    return { from: sorted[0], to: sorted[sorted.length - 1] };
  }
  const days = t.match(/\b(\d{1,2})\s*(din|days)\b/);
  let start = null;
  if (/\b(parso|day after tomorrow)\b/.test(t)) start = add(2);
  else if (/\b(kal|tomorrow|kl)\b/.test(t)) start = add(1);
  else if (/\b(aaj|today|abhi)\b/.test(t)) start = add(0);
  if (!start) return null;
  if (days) {
    const n = Math.min(Number(days[1]), 30);
    const end = new Date(new Date(`${start}T00:00:00Z`).getTime() + (n - 1) * 86400000).toISOString().slice(0, 10);
    return { from: start, to: end };
  }
  return { from: start, to: start };
}

export function certificateType(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(tc|transfer certificate|leaving certificate|school leaving)\b/.test(t)) return 'leaving_certificate';
  if (/\bcharacter\b/.test(t)) return 'character_certificate';
  if (/\bid card\b/.test(t)) return 'id_card';
  if (/\bfee (certificate|receipt for tax|tax)\b/.test(t)) return 'fee_certificate';
  return 'bonafide';
}

// Pick the child the parent means: by first name in the message, else the
// one they picked recently, else ask.
export function resolveChild(children, text, activeStudentId) {
  if (children.length === 1) return { child: children[0] };
  const t = String(text || '').toLowerCase();
  const byName = children.filter((c) => {
    const first = String(c.name || '').split(/\s+/)[0].toLowerCase();
    return first.length >= 2 && new RegExp(`\\b${first.replace(/[^a-z\u0900-\u097f]/g, '')}\\b`).test(t);
  });
  if (byName.length === 1) return { child: byName[0] };
  const active = children.find((c) => c.id === activeStudentId);
  if (active) return { child: active };
  return { ask: true };
}

const fmtDate = (d, lang) =>
  new Date(`${String(d instanceof Date ? d.toISOString().slice(0, 10) : d).slice(0, 10)}T00:00:00Z`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', weekday: 'short' });


// Short or mixed messages ("attendance batao", "1", "menu") don't reveal a
// language, so they keep the conversation's language, else the parent's
// saved preference. Only a clearly English sentence switches to English.
const HINGLISH_WORDS = /\b(hai|hain|kya|kitni|kitna|kitne|ji|bachha|bacha|beta|beti|chahiye|mera|meri|nahi|haan|karna|kaise|kab|kahan|kaha|aap|batao|bataiye|bata|ka|ki|ke|ko|se|mein|aayega|aayegi|kal|aaj|wala|wali)\b/i;
const ENGLISH_SENTENCE = /\b(the|is|are|what|when|where|my|please|will|does|do|how|can|could|would|today|tomorrow)\b/i;
export function replyLanguage(text, stateLang, preferred) {
  const script = detectLanguage(text);
  if (script === 'hi' || script === 'pa') return script;
  const t = String(text || '');
  if (HINGLISH_WORDS.test(t)) return 'hinglish';
  const words = t.trim().split(/\s+/).length;
  if (words >= 3 && ENGLISH_SENTENCE.test(t)) return 'en';
  if (stateLang) return stateLang;
  return preferred === 'en' ? 'en' : 'hinglish';
}

// ---------- Copy ----------

const T = {
  hinglish: {
    which_child: (list) => `Kis bachhe ke baare mein? Number reply karein:\n${list}`,
    menu: 'Main in cheezon mein madad kar sakta hoon:\n• Fees kitni baaki hai / payment link\n• Aaj ka homework\n• Attendance\n• Result\n• Chutti ki application (jaise "Aarav kal nahi aayega")\n• Holidays aur events\n• Bus kahan hai\n• Certificate chahiye\n• Teacher se baat\nHomework ka koi sawaal ho toh seedha likh dein ya photo bhejein.',
    thanks: '🙏',
    absence_ack: (n) => `Dhanyavaad, note kar liya.${n ? ` ${n} ke liye` : ''} Ab aapko call nahi aayegi.`,
    fee_none: (n) => `${n} ki koi fee baaki nahi hai. 👍`,
    fee_due: (n, due, bus) => `${n} ki baaki fee: ${due}${bus ? ` (isme transport ${bus} shaamil hai)` : ''}.\nPayment link chahiye toh "pay" likhein.`,
    fee_unknown: (n) => `${n} ki fee ka record abhi update nahi hua hai. Office aapko jaldi bata dega.`,
    pay_link: (n, amt, url) => `${n} ki fee ${amt} ka payment link:\n${url}`,
    pay_failed: 'Payment link abhi nahi ban paaya. Office aapko link bhej dega.',
    receipt: (n, rows) => `${n} ki pichhli payments:\n${rows}`,
    receipt_none: (n) => `${n} ki koi payment record nahi mili.`,
    hw: (n, rows) => `${n} ka homework:\n${rows}`,
    hw_none: (n) => `${n} ki class ka aaj/kal ka koi homework nahi diya gaya hai.`,
    att: (n, pct, absent, dates) => `${n} ki pichhle 30 din ki attendance: ${pct}%.${absent ? ` Absent: ${absent} din (${dates}).` : ' Ek bhi din absent nahi. 👏'}`,
    att_none: (n) => `${n} ki attendance ka record abhi nahi hai.`,
    results: (n, exam, rows, total) => `${n}: ${exam}\n${rows}\nTotal: ${total}`,
    results_none: (n) => `${n} ka koi result abhi publish nahi hua hai.`,
    events: (rows) => `Aane wale holidays/events:\n${rows}`,
    events_none: 'Agle 30 din mein koi holiday ya event list nahi hai.',
    bus: (n, bus, mins, km) => `${n} ki bus (${bus}) ${mins} min pehle ${km !== null ? `aapke stop se lagbhag ${km} km door thi` : 'chal rahi thi'}.`,
    bus_stale: (n, bus) => `${n} ki bus (${bus}) ki live location abhi available nahi hai. Driver se sampark ke liye office ko call karein.`,
    bus_none: (n) => `${n} school transport mein registered nahi hai.`,
    tt: (n, day, rows) => `${n} ka ${day} ka timetable:\n${rows}`,
    tt_none: (n) => `${n} ki class ka timetable abhi set nahi hai.`,
    leave_ask_date: (n) => `${n} kis din nahi aayega/aayegi? (jaise "kal", "aaj", ya "28/9")`,
    leave_done: (n, from, to) => `${n} ki chutti ki application bhej di gayi hai (${from}${to !== from ? ` se ${to}` : ''}). Class teacher approve karenge.`,
    leave_dup: (n) => `${n} ki in dino ki application pehle se hai.`,
    cert_done: (n, type) => `${n} ke ${type} ki request bhej di gayi hai. Ready hone par aapko bata denge.`,
    cert_dup: (n, type) => `${n} ke ${type} ki request pehle se chal rahi hai.`,
    teacher: (n) => `Maine ${n} ke class teacher ko bata diya hai. Woh aapse jaldi sampark karenge.`,
    complaint: 'Aapki baat note kar li gayi hai. School ki taraf se koi aapse jaldi baat karega.',
    safety: 'Aapne jo bataya woh bahut gambhir hai. Maine turant principal ko inform kar diya hai, school se koi aapko jaldi call karega. Agar bachha abhi khatre mein hai toh 112 par call karein.',
    human_paused: '',
    rate_limited: '',
  },
  en: {
    which_child: (list) => `Which child is this about? Reply with a number:\n${list}`,
    menu: 'I can help with:\n• Fee balance / payment link\n• Today\'s homework\n• Attendance\n• Results\n• Leave application (e.g. "Aarav won\'t come tomorrow")\n• Holidays and events\n• Where is the bus\n• Certificates\n• Talking to the teacher\nFor a homework question, just type it or send a photo.',
    thanks: '🙏',
    absence_ack: (n) => `Thank you, noted${n ? ` for ${n}` : ''}. You won't get a call.`,
    fee_none: (n) => `No fees are due for ${n}. 👍`,
    fee_due: (n, due, bus) => `Fees due for ${n}: ${due}${bus ? ` (includes transport ${bus})` : ''}.\nReply "pay" for a payment link.`,
    fee_unknown: (n) => `${n}'s fee record isn't updated yet. The office will let you know shortly.`,
    pay_link: (n, amt, url) => `Payment link for ${n}'s fees (${amt}):\n${url}`,
    pay_failed: "I couldn't create a payment link right now. The office will send you one.",
    receipt: (n, rows) => `Recent payments for ${n}:\n${rows}`,
    receipt_none: (n) => `No payments found for ${n}.`,
    hw: (n, rows) => `Homework for ${n}:\n${rows}`,
    hw_none: (n) => `No homework has been set for ${n}'s class for today or tomorrow.`,
    att: (n, pct, absent, dates) => `${n}'s attendance in the last 30 days: ${pct}%.${absent ? ` Absent ${absent} day(s): ${dates}.` : ' Not absent once. 👏'}`,
    att_none: (n) => `No attendance recorded for ${n} yet.`,
    results: (n, exam, rows, total) => `${n}: ${exam}\n${rows}\nTotal: ${total}`,
    results_none: (n) => `No results have been published for ${n} yet.`,
    events: (rows) => `Upcoming holidays and events:\n${rows}`,
    events_none: 'No holidays or events are listed for the next 30 days.',
    bus: (n, bus, mins, km) => `${n}'s bus (${bus}) was ${km !== null ? `about ${km} km from your stop` : 'moving'} ${mins} min ago.`,
    bus_stale: (n, bus) => `Live location for ${n}'s bus (${bus}) isn't available right now. Please call the office to reach the driver.`,
    bus_none: (n) => `${n} isn't registered for school transport.`,
    tt: (n, day, rows) => `${n}'s timetable for ${day}:\n${rows}`,
    tt_none: (n) => `${n}'s class timetable isn't set up yet.`,
    leave_ask_date: (n) => `Which day will ${n} be absent? (e.g. "tomorrow", "today" or "28/9")`,
    leave_done: (n, from, to) => `Leave application sent for ${n} (${from}${to !== from ? ` to ${to}` : ''}). The class teacher will approve it.`,
    leave_dup: (n) => `There is already a leave application for ${n} on these dates.`,
    cert_done: (n, type) => `Request for ${n}'s ${type} sent. We'll tell you when it's ready.`,
    cert_dup: (n, type) => `A request for ${n}'s ${type} is already in progress.`,
    teacher: (n) => `I've told ${n}'s class teacher. They will contact you soon.`,
    complaint: "Your concern has been noted. Someone from the school will speak to you soon.",
    safety: "What you've described is serious. I've informed the principal right away and someone from the school will call you shortly. If your child is in danger right now, call 112.",
  },
  hi: {
    which_child: (list) => `किस बच्चे के बारे में? नंबर लिखकर जवाब दें:\n${list}`,
    safety: 'आपने जो बताया वह बहुत गंभीर है। मैंने तुरंत प्रिंसिपल को सूचित कर दिया है, स्कूल से कोई आपको जल्द कॉल करेगा। अगर बच्चा अभी खतरे में है तो 112 पर कॉल करें।',
    absence_ack: (n) => `धन्यवाद, नोट कर लिया।${n ? ` ${n} के लिए` : ''} अब आपको कॉल नहीं आएगी।`,
  },
};
// Hindi only overrides a few high-stakes messages; everything else falls back to Hinglish.
export function copy(lang) {
  if (lang === 'en') return T.en;
  if (lang === 'hi' || lang === 'pa') return { ...T.hinglish, ...T.hi };
  return T.hinglish;
}

const CERT_LABEL = {
  bonafide: 'bonafide certificate',
  character_certificate: 'character certificate',
  leaving_certificate: 'transfer certificate (TC)',
  id_card: 'ID card',
  fee_certificate: 'fee certificate',
};

// ---------- Handlers: each returns { text, handledBy? } ----------

async function istToday() {
  const r = await pool.query(`SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS d, EXTRACT(ISODOW FROM (NOW() AT TIME ZONE 'Asia/Kolkata'))::int AS dow`);
  return r.rows[0];
}

const handlers = {
  async fee_balance({ child, c }) {
    const r = await pool.query(`SELECT amount_due, amount_paid FROM student_payment WHERE student_id = $1`, [child.id]);
    const bus = await pool.query(
      `SELECT COALESCE(SUM(monthly_fee), 0) AS due FROM student_transport_fees WHERE student_id = $1 AND collection_status <> 'collected'`,
      [child.id]
    );
    const busDue = Number(bus.rows[0]?.due || 0);
    if (!r.rowCount && !busDue) return { text: c.fee_unknown(child.first) };
    const due = Math.max(0, Number(r.rows[0]?.amount_due || 0) - Number(r.rows[0]?.amount_paid || 0)) + busDue;
    if (due <= 0) return { text: c.fee_none(child.first) };
    return { text: c.fee_due(child.first, inr(due), busDue ? inr(busDue) : null) };
  },

  async pay_now({ child, c, parent }) {
    const r = await pool.query(`SELECT amount_due, amount_paid FROM student_payment WHERE student_id = $1`, [child.id]);
    const due = Math.max(0, Number(r.rows[0]?.amount_due || 0) - Number(r.rows[0]?.amount_paid || 0));
    if (!due) return { text: c.fee_none(child.first) };
    try {
      // Same function the fee-reminder worker and the Fees screen use.
      const { link } = await createPaymentLinkRecord(parent.school_id, child.id, due, null);
      return { text: c.pay_link(child.first, inr(due), link.razorpay_link_url) };
    } catch (err) {
      await raiseException({
        schoolId: parent.school_id,
        source: 'parent_assistant',
        severity: 'medium',
        title: `Parent asked for a payment link, but it couldn't be created (${child.name})`,
        body: `Due: ${inr(due)}. Error: ${err.message}. Send the link manually from Fees.`,
        entityType: 'student',
        entityId: child.id,
        dedupeKey: `paylink_failed:${child.id}`,
      });
      return { text: c.pay_failed, handledBy: 'escalated' };
    }
  },

  async fee_receipt({ child, c }) {
    const r = await pool.query(
      `SELECT amount_paid, payment_mode, created_at FROM student_payment_history WHERE student_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [child.id]
    );
    if (!r.rowCount) return { text: c.receipt_none(child.first) };
    return { text: c.receipt(child.first, r.rows.map((p) => `• ${fmtDate(p.created_at)}: ${inr(p.amount_paid)} (${p.payment_mode})`).join('\n')) };
  },

  async homework_today({ child, c }) {
    const r = await pool.query(
      `SELECT subject_id, title, description, due_date FROM homework
       WHERE class_id = $1 AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date - 1
          OR (class_id = $1 AND due_date BETWEEN (NOW() AT TIME ZONE 'Asia/Kolkata')::date AND (NOW() AT TIME ZONE 'Asia/Kolkata')::date + 1)
       ORDER BY due_date NULLS LAST, id DESC LIMIT 8`,
      [child.class_id]
    );
    if (!r.rowCount) return { text: c.hw_none(child.first) };
    return {
      text: c.hw(
        child.first,
        r.rows.map((h) => `• ${h.subject_id}: ${h.title}${h.due_date ? ` (due ${fmtDate(h.due_date)})` : ''}`).join('\n')
      ),
    };
  },

  async attendance({ child, c }) {
    const r = await pool.query(
      `SELECT date, status FROM attendance WHERE student_id = $1 AND date > (NOW() AT TIME ZONE 'Asia/Kolkata')::date - 30 ORDER BY date`,
      [child.id]
    );
    if (!r.rowCount) return { text: c.att_none(child.first) };
    const absent = r.rows.filter((a) => a.status === 'absent');
    const pct = Math.round(((r.rowCount - absent.length) / r.rowCount) * 100);
    return { text: c.att(child.first, pct, absent.length, absent.slice(-5).map((a) => fmtDate(a.date)).join(', ')) };
  },

  async results({ child, c }) {
    const exam = await pool.query(
      `SELECT DISTINCT e.id, e.name, e.result_published_at FROM exams e JOIN exam_marks m ON m.exam_id = e.id
       WHERE m.student_id = $1 AND e.result_published_at IS NOT NULL ORDER BY e.result_published_at DESC LIMIT 1`,
      [child.id]
    );
    if (!exam.rowCount) return { text: c.results_none(child.first) };
    const marks = await pool.query(
      `SELECT COALESCE(s.name, 'Subject') AS subject, m.marks_obtained, m.max_marks FROM exam_marks m LEFT JOIN subjects s ON s.id = m.subject_id
       WHERE m.exam_id = $1 AND m.student_id = $2 ORDER BY s.name`,
      [exam.rows[0].id, child.id]
    );
    const got = marks.rows.reduce((a, m) => a + Number(m.marks_obtained || 0), 0);
    const max = marks.rows.reduce((a, m) => a + Number(m.max_marks || 0), 0);
    return {
      text: c.results(
        child.first,
        exam.rows[0].name,
        marks.rows.map((m) => `• ${m.subject}: ${Number(m.marks_obtained)}/${Number(m.max_marks)}`).join('\n'),
        `${got}/${max}${max ? ` (${Math.round((got / max) * 100)}%)` : ''}`
      ),
    };
  },

  async holidays_events({ parent, c }) {
    const r = await pool.query(
      `SELECT title, event_date, end_date, event_type FROM school_events
       WHERE school_id = $1 AND audience IN ('all', 'parents')
         AND COALESCE(end_date, event_date) >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date
         AND event_date <= (NOW() AT TIME ZONE 'Asia/Kolkata')::date + 30
       ORDER BY event_date LIMIT 8`,
      [parent.school_id]
    );
    if (!r.rowCount) return { text: c.events_none };
    return {
      text: c.events(
        r.rows.map((e) => `• ${fmtDate(e.event_date)}${e.end_date && String(e.end_date) !== String(e.event_date) ? ` – ${fmtDate(e.end_date)}` : ''}: ${e.title}`).join('\n')
      ),
    };
  },

  async bus_location({ child, c }) {
    const bus = await pool.query(
      `SELECT b.id, COALESCE(b.vehicle_number, b.route_name, 'bus') AS label FROM student_transport_fees stf JOIN buses b ON b.id = stf.bus_id
       WHERE stf.student_id = $1 ORDER BY stf.billing_month DESC, stf.id DESC LIMIT 1`,
      [child.id]
    );
    if (!bus.rowCount) return { text: c.bus_none(child.first) };
    const loc = await pool.query(
      `SELECT latitude, longitude, recorded_at, EXTRACT(EPOCH FROM (NOW() - recorded_at)) / 60 AS age_min
       FROM bus_location_log WHERE bus_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [bus.rows[0].id]
    );
    const l = loc.rows[0];
    if (!l || Number(l.age_min) > 10) return { text: c.bus_stale(child.first, bus.rows[0].label) };
    let km = null;
    if (child.home_latitude != null && child.home_longitude != null) {
      km = Math.round((haversineMeters(Number(l.latitude), Number(l.longitude), Number(child.home_latitude), Number(child.home_longitude)) / 1000) * 10) / 10;
    }
    return { text: c.bus(child.first, bus.rows[0].label, Math.max(0, Math.round(Number(l.age_min))), km) };
  },

  async timetable({ child, c, text }) {
    const { dow } = await istToday();
    const tomorrow = /\b(kal|tomorrow)\b/i.test(text);
    let day = tomorrow ? (dow % 7) + 1 : dow;
    if (day === 7) day = 1; // Sunday → Monday
    const r = await pool.query(
      `SELECT ts.period_number, ts.start_time, COALESCE(s.name, 'Period') AS subject FROM timetable_slots ts LEFT JOIN subjects s ON s.id = ts.subject_id
       WHERE ts.class_id = $1 AND ts.day_of_week = $2 ORDER BY ts.period_number`,
      [child.class_id, day]
    );
    if (!r.rowCount) return { text: c.tt_none(child.first) };
    const names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return { text: c.tt(child.first, names[day], r.rows.map((p) => `${p.period_number}. ${p.subject}${p.start_time ? ` (${String(p.start_time).slice(0, 5)})` : ''}`).join('\n')) };
  },

  async leave_request({ child, c, text, parent, state }) {
    const { d: today } = await istToday();
    const dates = parseLeaveDates(text, today);
    if (!dates) {
      state.awaiting = 'leave_date';
      state.pending_intent = 'leave_request';
      return { text: c.leave_ask_date(child.first) };
    }
    state.awaiting = null;
    state.pending_intent = null;
    const dup = await pool.query(
      `SELECT 1 FROM student_leave_requests WHERE student_id = $1 AND status <> 'DECLINED' AND from_date <= $3 AND to_date >= $2`,
      [child.id, dates.from, dates.to]
    );
    if (dup.rowCount) return { text: c.leave_dup(child.first) };
    const reason = String(state.leave_reason_text || text).slice(0, 500);
    await pool.query(
      `INSERT INTO student_leave_requests (school_id, student_id, class_id, from_date, to_date, reason) VALUES ($1, $2, $3, $4, $5, $6)`,
      [parent.school_id, child.id, child.class_id, dates.from, dates.to, `Via WhatsApp: ${reason}`]
    );
    state.leave_reason_text = null;
    await audit({ schoolId: parent.school_id, actorType: 'ai', action: 'parent.leave_requested', entityType: 'student', entityId: child.id, detail: dates });
    return { text: c.leave_done(child.first, fmtDate(dates.from), fmtDate(dates.to)) };
  },

  async certificate_request({ child, c, text, parent }) {
    const type = certificateType(text);
    const dup = await pool.query(
      `SELECT 1 FROM document_requests WHERE student_id = $1 AND request_type = $2 AND status IN ('PENDING', 'APPROVED')`,
      [child.id, type]
    );
    if (dup.rowCount) return { text: c.cert_dup(child.first, CERT_LABEL[type]) };
    await pool.query(`INSERT INTO document_requests (school_id, student_id, request_type) VALUES ($1, $2, $3)`, [parent.school_id, child.id, type]);
    await audit({ schoolId: parent.school_id, actorType: 'ai', action: 'parent.certificate_requested', entityType: 'student', entityId: child.id, detail: { type } });
    if (type === 'leaving_certificate') {
      await raiseException({
        schoolId: parent.school_id,
        source: 'parent_assistant',
        severity: 'high',
        title: `TC requested for ${child.name}: family may be leaving`,
        body: `The parent asked for a transfer certificate on WhatsApp: "${String(text).slice(0, 200)}". Worth a call before processing: it may be a fee, transport or teacher issue that can be fixed.`,
        entityType: 'student',
        entityId: child.id,
        dedupeKey: `tc_request:${child.id}`,
      });
    }
    return { text: c.cert_done(child.first, CERT_LABEL[type]) };
  },

  async talk_to_teacher({ child, c, text, parent }) {
    const t = await pool.query(`SELECT class_teacher_id FROM classes WHERE id = $1`, [child.class_id]);
    const teacherId = t.rows[0]?.class_teacher_id;
    if (teacherId) {
      await pool.query(
        `INSERT INTO dashboard_notifications (school_id, trigger_event, recipient_type, recipient_id, student_id, channel_used, title, body)
         VALUES ($1, 'parent_wants_call', 'staff', $2, $3, 'dashboard', $4, $5)`,
        [parent.school_id, teacherId, child.id, `Parent of ${child.name} wants to talk`, `"${String(text).slice(0, 300)}" (${parent.name}, ${parent.phone})`]
      );
    }
    await raiseException({
      schoolId: parent.school_id,
      source: 'parent_assistant',
      severity: teacherId ? 'low' : 'medium',
      title: `Parent of ${child.name} wants to talk to the teacher`,
      body: `"${String(text).slice(0, 300)}"\n${parent.name}, ${parent.phone}.${teacherId ? ' The class teacher has been notified on their dashboard.' : ' This class has no class teacher assigned, so nobody was notified automatically.'}`,
      entityType: 'student',
      entityId: child.id,
      dedupeKey: `talk_teacher:${child.id}`,
    });
    return { text: c.teacher(child.first), handledBy: 'escalated' };
  },

  async complaint({ child, c, text, parent }) {
    await raiseException({
      schoolId: parent.school_id,
      source: 'parent_assistant',
      severity: 'high',
      title: `Complaint from parent${child ? ` of ${child.name}` : ''}`,
      body: `"${String(text).slice(0, 500)}"\n${parent.name}, ${parent.phone}. Call them back today.`,
      entityType: child ? 'student' : null,
      entityId: child?.id || null,
      suggestedAction: { label: 'Pause assistant for this parent (24 h)', action: 'parent.takeover', params: { parent_id: parent.id, hours: 24 } },
      dedupeKey: `complaint:${parent.id}`,
    });
    return { text: c.complaint, handledBy: 'escalated' };
  },
};

const NEEDS_CHILD = new Set(['fee_balance', 'pay_now', 'fee_receipt', 'homework_today', 'attendance', 'results', 'bus_location', 'timetable', 'leave_request', 'certificate_request', 'talk_to_teacher']);

// ---------- Optional AI classification ----------

async function aiIntent(text) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const r = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-5',
        max_tokens: 30,
        system:
          'Classify a WhatsApp message a parent sent to their child\'s school. Reply with exactly one label and nothing else: ' +
          [...INTENTS.filter((i) => i !== 'thanks'), 'homework_doubt', 'other'].join(', ') +
          '. Use safety for anything about a child being hurt, bullied, threatened, abused or unsafe. Use homework_doubt for a question about a school subject or a homework problem.',
        messages: [{ role: 'user', content: String(text).slice(0, 1000) }],
      },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 15000 }
    );
    const label = (r.data?.content?.find((b) => b.type === 'text')?.text || '').trim().toLowerCase();
    return [...INTENTS, 'homework_doubt', 'other'].includes(label) ? label : null;
  } catch (err) {
    console.error('[parentAssistant] AI intent failed:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

// ---------- Messaging helpers ----------

async function logParentMessage({ parent, studentId = null, direction, body, intent = null, handledBy = null, waMessageId = null, deliveryStatus }) {
  const r = await pool.query(
    `INSERT INTO parent_messages (school_id, parent_id, student_id, direction, body, intent, handled_by, wa_message_id, delivery_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING RETURNING id`,
    [parent.school_id, parent.id, studentId, direction, body, intent, handledBy, waMessageId, deliveryStatus || (direction === 'in' ? 'received' : 'sent')]
  );
  return r.rowCount > 0;
}

export async function replyToParent(parent, body, { studentId = null, intent = null, handledBy = 'assistant' } = {}) {
  let ok = true;
  try {
    await sendTextMessage(String(parent.phone).replace(/^\+/, ''), body);
  } catch (err) {
    ok = false;
    console.error(`[parentAssistant] send failed for parent ${parent.id}:`, err.response?.data?.error?.message || err.message);
  }
  await logParentMessage({ parent, studentId, direction: 'out', body, intent, handledBy, deliveryStatus: ok ? 'sent' : 'failed' });
  return ok;
}

async function loadConversation(parent) {
  const r = await pool.query(
    `INSERT INTO parent_conversations (parent_id, school_id) VALUES ($1, $2)
     ON CONFLICT (parent_id) DO UPDATE SET updated_at = NOW() RETURNING *`,
    [parent.id, parent.school_id]
  );
  const conv = r.rows[0];
  const expired = conv.state_expires_at && new Date(conv.state_expires_at) < new Date();
  return { conv, state: expired ? {} : { ...(conv.state || {}) } };
}

async function saveConversation(parent, state, activeStudentId) {
  await pool.query(
    `UPDATE parent_conversations SET state = $2, active_student_id = COALESCE($3, active_student_id),
            state_expires_at = NOW() + INTERVAL '30 minutes', last_inbound_at = NOW(), updated_at = NOW()
     WHERE parent_id = $1`,
    [parent.id, JSON.stringify(state), activeStudentId]
  );
}

// ---------- Main entry point ----------
// Returns { handled: true } when the assistant replied, or
// { handled: false } to let the caller run the homework-doubt pipeline.

export async function handleParentMessage({ parent, text, waMessageId, repliedToAbsence = false }) {
  const startedAt = new Date();
  const fresh = await logParentMessage({ parent, direction: 'in', body: text, waMessageId });
  if (!fresh) return { handled: true, duplicate: true }; // Meta retry

  try {
    const { conv, state } = await loadConversation(parent);

    // Staff took over this conversation.
    if (conv.human_takeover_until && new Date(conv.human_takeover_until) > new Date()) {
      await raiseException({
        schoolId: parent.school_id,
        source: 'parent_assistant',
        severity: 'medium',
        title: `New message from ${parent.name} (you're handling this chat)`,
        body: `"${String(text).slice(0, 300)}"`,
        entityType: 'parent',
        entityId: parent.id,
        dedupeKey: `parent_takeover:${parent.id}`,
      });
      await saveConversation(parent, state, null);
      return { handled: true, paused: true };
    }

    // Flood guard: a stuck phone or a spammer shouldn't burn AI calls.
    const recent = await pool.query(
      `SELECT COUNT(*)::int AS n FROM parent_messages WHERE parent_id = $1 AND direction = 'in' AND created_at > NOW() - INTERVAL '1 hour'`,
      [parent.id]
    );
    if (recent.rows[0].n > 30) {
      await raiseException({
        schoolId: parent.school_id,
        source: 'parent_assistant',
        severity: 'low',
        title: `Unusually many messages from ${parent.name}: assistant paused for them`,
        body: `${recent.rows[0].n} messages in the last hour. Replies resume automatically when it slows down.`,
        entityType: 'parent',
        entityId: parent.id,
        dedupeKey: `parent_flood:${parent.id}`,
      });
      return { handled: true, rateLimited: true };
    }

    const lang = replyLanguage(text, state.lang, parent.preferred_language);
    const c = copy(lang);
    state.lang = lang;

    const kids = await pool.query(
      `SELECT id, name, class_id, home_latitude, home_longitude FROM students WHERE parent_id = $1 AND school_id = $2 ORDER BY name`,
      [parent.id, parent.school_id]
    );
    const children = kids.rows.map((k) => ({ ...k, first: String(k.name).split(/\s+/)[0] }));

    // Answering "which child?" with a number.
    let intent = null;
    let workingText = text;
    let child = null;
    if (state.awaiting === 'child' && /^\s*\d\s*$/.test(text) && children[Number(text) - 1]) {
      child = children[Number(text) - 1];
      intent = state.pending_intent;
      workingText = state.pending_text || text;
      state.awaiting = null;
    } else if (state.awaiting === 'leave_date') {
      intent = 'leave_request';
      state.leave_reason_text = state.pending_text;
    }

    intent = intent || keywordIntent(text);

    // A reply to today's absence alert is acknowledged, not treated as a doubt.
    if (!intent && repliedToAbsence) intent = 'absence_reply';
    if (!intent) intent = await aiIntent(text);

    if (!intent || intent === 'homework_doubt' || intent === 'other') {
      await saveConversation(parent, state, null);
      await pool.query(`UPDATE parent_messages SET intent = 'homework_doubt', handled_by = 'doubt_bot' WHERE wa_message_id = $1`, [waMessageId]);
      return { handled: false };
    }

    // Safety first, never waits on a child choice.
    if (intent === 'safety') {
      const named = resolveChild(children, text, null).child;
      await raiseException({
        schoolId: parent.school_id,
        source: 'parent_assistant',
        severity: 'critical',
        title: `Child safety concern raised by ${parent.name}${named ? ` (${named.name})` : ''}`,
        body: `Parent's message: "${String(text).slice(0, 800)}"\n\nCall ${parent.phone} now. The assistant has not given any advice; it told the parent the principal has been informed.`,
        entityType: named ? 'student' : 'parent',
        entityId: named ? named.id : parent.id,
        suggestedAction: { label: 'Pause assistant for this parent (24 h)', action: 'parent.takeover', params: { parent_id: parent.id, hours: 24 } },
        dedupeKey: `safety:${parent.id}`,
      });
      await audit({ schoolId: parent.school_id, actorType: 'ai', action: 'parent.safety_escalated', entityType: 'parent', entityId: parent.id });
      await replyToParent(parent, c.safety, { intent, handledBy: 'escalated', studentId: named?.id });
      await saveConversation(parent, state, null);
      await recordRun({ key: 'parent_assistant', schoolId: parent.school_id, status: 'success', startedAt, itemsTotal: 1, itemsSucceeded: 1 });
      return { handled: true, intent };
    }

    if (intent === 'menu' || intent === 'thanks' || intent === 'absence_reply') {
      const body = intent === 'menu' ? c.menu : intent === 'thanks' ? c.thanks : c.absence_ack(children.length === 1 ? children[0].first : null);
      await replyToParent(parent, body, { intent });
      await saveConversation(parent, state, null);
      await recordRun({ key: 'parent_assistant', schoolId: parent.school_id, status: 'success', startedAt, itemsTotal: 1, itemsSucceeded: 1 });
      return { handled: true, intent };
    }

    if (NEEDS_CHILD.has(intent) && !child) {
      if (!children.length) {
        await raiseException({
          schoolId: parent.school_id,
          source: 'parent_assistant',
          severity: 'medium',
          title: `Opted-in parent with no linked child: ${parent.name}`,
          body: `They asked: "${String(text).slice(0, 200)}". Link their child in the student record so the assistant can answer.`,
          entityType: 'parent',
          entityId: parent.id,
          dedupeKey: `parent_no_child:${parent.id}`,
        });
        await replyToParent(parent, c.complaint, { intent, handledBy: 'escalated' });
        return { handled: true, intent };
      }
      const pick = resolveChild(children, text, state.awaiting === 'child' ? null : conv.active_student_id);
      if (pick.ask) {
        state.awaiting = 'child';
        state.pending_intent = intent;
        state.pending_text = text;
        await replyToParent(parent, c.which_child(children.map((k, i) => `${i + 1}. ${k.first}`).join('\n')), { intent });
        await saveConversation(parent, state, null);
        return { handled: true, intent, askedChild: true };
      }
      child = pick.child;
    }

    if (intent === 'leave_request' && !state.leave_reason_text) state.pending_text = text;
    const handler = handlers[intent];
    const out = await handler({ parent, child, c, text: workingText, state });
    await replyToParent(parent, out.text, { intent, studentId: child?.id, handledBy: out.handledBy || 'assistant' });
    await pool.query(`UPDATE parent_messages SET intent = $2, student_id = $3, handled_by = $4 WHERE wa_message_id = $1`, [waMessageId, intent, child?.id || null, out.handledBy || 'assistant']);
    await saveConversation(parent, state, child?.id || null);
    await recordRun({ key: 'parent_assistant', schoolId: parent.school_id, status: 'success', startedAt, itemsTotal: 1, itemsSucceeded: 1 });
    return { handled: true, intent, studentId: child?.id };
  } catch (err) {
    console.error('[parentAssistant] failed:', err.stack || err.message);
    await recordRun({ key: 'parent_assistant', schoolId: parent.school_id, status: 'failed', startedAt, itemsTotal: 1, itemsFailed: 1, errorSummary: err.message });
    await raiseException({
      schoolId: parent.school_id,
      source: 'parent_assistant',
      severity: 'high',
      title: `Couldn't answer a message from ${parent.name}`,
      body: `Message: "${String(text).slice(0, 300)}"\nError: ${err.message}\n\nReply to them from Parent messages, or call ${parent.phone}.`,
      entityType: 'parent',
      entityId: parent.id,
      dedupeKey: `parent_fail:${parent.id}`,
    });
    return { handled: true, error: err.message };
  }
}
