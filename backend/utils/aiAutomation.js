// Pure helpers for the AI automation roadmap (phases 1–2). No database, no
// network — everything here is unit-tested in tests/aiAutomation.test.js.
//
// The rule that runs through all of it: numbers and decisions come from the
// data (these functions); the AI only rewrites them into friendly sentences,
// and every AI sentence has a template fallback so nothing depends on it.

// ---------- dates ----------

// ISO week label, e.g. '2026-W42', for a 'YYYY-MM-DD' date string.
export function isoWeekLabel(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Today's date in India as 'YYYY-MM-DD', independent of the server timezone.
export function istToday(now = new Date()) {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export function istHour(now = new Date()) {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).getUTCHours();
}

const pct = (part, whole) => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : null);

// ---------- A1: early-warning scoring ----------

// Strong signals (weight 2) can raise a flag; supporting signals (weight 1)
// only add to one. A student is flagged when at least one strong signal is
// present AND the total reaches minScore — a deliberately high bar so the
// first weeks don't bury teachers in false alarms.
export const EARLY_WARNING_DEFAULTS = {
  minScore: 3,
  attendanceLowPct: 75,
  attendanceDropPts: 15,
  absenceStreak: 3,
  marksDropPts: 15,
  marksLowPct: 40,
  homeworkLowPct: 50,
  leaveCount30d: 3,
  feeOverdueDays: 90,
};

/**
 * facts = {
 *   att_recent: {present, total},   // last 14 days
 *   att_prior: {present, total},    // the 4 weeks before that
 *   absence_streak,                  // consecutive absent days up to the latest marked day
 *   marks_recent_pct, marks_prior_pct, // exam averages: last 45 days / 45–180 days before
 *   hw: {assigned, completed},       // shared homework, last 14 days
 *   leaves_30d,
 *   struggles,                       // AI tutor profile: number of "finds difficult" items
 *   fee: {due, days_since_payment}   // principal-only context
 * }
 */
export function scoreStudent(facts = {}, opts = {}) {
  const t = { ...EARLY_WARNING_DEFAULTS, ...opts };
  const signals = [];
  const add = (key, weight, label, evidence, extra = {}) => signals.push({ key, weight, label, evidence, ...extra });

  const recent = facts.att_recent || {};
  const prior = facts.att_prior || {};
  const recentPct = recent.total >= 5 ? pct(recent.present, recent.total) : null;
  const priorPct = prior.total >= 10 ? pct(prior.present, prior.total) : null;
  if (recentPct !== null && recentPct < t.attendanceLowPct) {
    add('attendance_low', 2, 'Low attendance', `${recentPct}% in the last 2 weeks (${recent.present} of ${recent.total} days)`);
  }
  if (recentPct !== null && priorPct !== null && priorPct - recentPct >= t.attendanceDropPts) {
    // Already counted as low? Then the drop only supports it.
    add('attendance_drop', signals.some((s) => s.key === 'attendance_low') ? 1 : 2, 'Attendance falling', `${priorPct}% before, ${recentPct}% in the last 2 weeks`);
  }
  if ((facts.absence_streak || 0) >= t.absenceStreak) {
    add('absence_streak', 2, 'Absent several days in a row', `${facts.absence_streak} days in a row`);
  }

  const mr = facts.marks_recent_pct;
  const mp = facts.marks_prior_pct;
  if (mr !== null && mr !== undefined && mp !== null && mp !== undefined && mp - mr >= t.marksDropPts) {
    add('marks_drop', 2, 'Marks falling', `about ${Math.round(mp)}% earlier, ${Math.round(mr)}% in recent tests`);
  } else if (mr !== null && mr !== undefined && mr < t.marksLowPct) {
    add('marks_low', 2, 'Low recent marks', `about ${Math.round(mr)}% in recent tests`);
  }

  const hw = facts.hw || {};
  if (hw.assigned >= 3) {
    const done = pct(hw.completed, hw.assigned);
    if (done < t.homeworkLowPct) add('homework_low', 1, 'Homework not completed', `${hw.completed} of ${hw.assigned} done in the last 2 weeks`);
  }
  if ((facts.leaves_30d || 0) >= t.leaveCount30d) {
    add('frequent_leave', 1, 'Frequent leave requests', `${facts.leaves_30d} leave requests in 30 days`);
  }
  if ((facts.struggles || 0) >= 2) {
    add('tutor_struggles', 1, 'Struggling in AI tutor sessions', `${facts.struggles} topics noted as difficult`);
  }
  const fee = facts.fee || {};
  if (fee.due > 0 && (fee.days_since_payment ?? Infinity) >= t.feeOverdueDays) {
    // Context for the principal only: never shown to teachers, never in the
    // reason text, and never enough on its own to flag a child.
    add('fee_overdue', 1, 'Fees overdue', `₹${Math.round(fee.due).toLocaleString('en-IN')} due, no payment for ${Number.isFinite(fee.days_since_payment) ? `${fee.days_since_payment} days` : 'this year'}`, { principal_only: true });
  }

  const score = signals.reduce((a, s) => a + s.weight, 0);
  const hasStrong = signals.some((s) => s.weight >= 2);
  return { score, signals, flagged: hasStrong && score >= t.minScore };
}

// Signals a class teacher may see (the fee signal is principal-only).
export function teacherSignals(signals) {
  return (signals || []).filter((s) => !s.principal_only);
}

const FIRST_STEPS = {
  absence_streak: 'Call the parent today to check in about the absences.',
  attendance_low: 'Have a short, friendly check-in with the parent about attendance.',
  attendance_drop: 'Have a short, friendly check-in with the parent about attendance.',
  marks_drop: 'Spend 10 minutes with the student going over the last test together.',
  marks_low: 'Spend 10 minutes with the student going over the last test together.',
  homework_low: 'Ask the student what is getting in the way of homework this week.',
  frequent_leave: 'Check with the parent whether anything is making school hard right now.',
  tutor_struggles: 'Give one short practice task on the topic the student finds difficult.',
};

export function fallbackReason(firstName, signals) {
  const shown = teacherSignals(signals);
  const parts = shown.map((s) => `${s.label.toLowerCase()} (${s.evidence})`);
  return `${firstName || 'This student'}: ${parts.join('; ')}.`;
}

// Most urgent first: an ongoing absence beats a slow trend.
const URGENCY = Object.keys(FIRST_STEPS);

export function fallbackFirstStep(signals) {
  const shown = teacherSignals(signals);
  const top = [...shown].sort((a, b) => b.weight - a.weight || URGENCY.indexOf(a.key) - URGENCY.indexOf(b.key))[0];
  return FIRST_STEPS[top?.key] || 'Have a short check-in with the student this week.';
}

// ---------- A2: parent note safety ----------

// Labels a note about a child must never contain (English, Hinglish, Hindi,
// Punjabi). A match means the AI note is thrown away and rewritten or
// replaced by the template note.
const BANNED = [
  'weak', 'lazy', 'dull', 'slow learner', 'stupid', 'careless', 'bad student', 'poor student', 'failure', 'failing', 'fail',
  'naughty', 'disobedient', 'problem child', 'kamzor', 'kamjor', 'nalayak', 'aalsi', 'aalasi',
  'कमजोर', 'कमज़ोर', 'आलसी', 'नालायक', 'ਕਮਜ਼ੋਰ', 'ਆਲਸੀ', 'ਨਾਲਾਇਕ',
];

export function noteProblems(note) {
  const text = String(note || '').trim();
  const problems = [];
  if (!text) problems.push('empty');
  if (text.length > 700) problems.push('too_long');
  const lower = text.toLowerCase();
  for (const w of BANNED) {
    const re = /^[a-z ]+$/.test(w) ? new RegExp(`\\b${w}\\b`, 'i') : null;
    if (re ? re.test(lower) : text.includes(w)) {
      problems.push(`label:${w}`);
      break;
    }
  }
  if (/https?:\/\//i.test(text)) problems.push('link');
  if (/\d{10}/.test(text.replace(/\s/g, ''))) problems.push('phone_number');
  return problems;
}

// WhatsApp template parameters cannot contain newlines, tabs or 4+ spaces.
export function toTemplateParam(text, max = 700) {
  return String(text ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, max);
}

// Which language a parent's note is written in.
export function noteLanguage(setting, parentPreferred) {
  if (setting === 'en' || setting === 'hinglish') return setting;
  return ['hi', 'pa', 'en'].includes(parentPreferred) ? parentPreferred : 'hi';
}

export const LANGUAGE_NAMES = {
  en: 'simple English',
  hi: 'simple Hindi in Devanagari script',
  pa: 'simple Punjabi in Gurmukhi script',
  hinglish: 'casual Hinglish (Hindi in Latin script mixed with English)',
};

// Template note when the AI is off, fails, or writes something unsafe. Uses
// only the week's facts. Positive first; one gentle suggestion at most.
export function fallbackNote(facts, language = 'en') {
  const name = facts.first_name || 'Your child';
  const a = facts.attendance_week;
  const h = facts.homework_week;
  const bits = { en: [], hi: [], pa: [], hinglish: [] };
  if (a?.total) {
    bits.en.push(`${name} attended ${a.present} of ${a.total} school days this week.`);
    bits.hi.push(`${name} इस हफ़्ते ${a.total} में से ${a.present} दिन स्कूल आए।`);
    bits.pa.push(`${name} ਇਸ ਹਫ਼ਤੇ ${a.total} ਵਿੱਚੋਂ ${a.present} ਦਿਨ ਸਕੂਲ ਆਏ।`);
    bits.hinglish.push(`${name} is hafte ${a.total} mein se ${a.present} din school aaye.`);
  }
  if (h?.assigned) {
    bits.en.push(`Homework done: ${h.completed} of ${h.assigned}.`);
    bits.hi.push(`होमवर्क: ${h.assigned} में से ${h.completed} पूरा किया।`);
    bits.pa.push(`ਹੋਮਵਰਕ: ${h.assigned} ਵਿੱਚੋਂ ${h.completed} ਪੂਰਾ ਕੀਤਾ।`);
    bits.hinglish.push(`Homework: ${h.assigned} mein se ${h.completed} complete kiya.`);
  }
  const strength = facts.strengths?.[0];
  if (strength) {
    bits.en.push(`Doing well: ${strength}.`);
    bits.hi.push(`अच्छा कर रहे हैं: ${strength}.`);
    bits.pa.push(`ਵਧੀਆ ਕਰ ਰਹੇ ਹਨ: ${strength}.`);
    bits.hinglish.push(`Achha kar rahe hain: ${strength}.`);
  }
  const next = facts.next_steps?.[0];
  if (next) {
    bits.en.push(`To help at home: ${next}.`);
    bits.hi.push(`घर पर मदद के लिए: ${next}.`);
    bits.pa.push(`ਘਰ ਵਿੱਚ ਮਦਦ ਲਈ: ${next}.`);
    bits.hinglish.push(`Ghar par madad ke liye: ${next}.`);
  }
  const list = bits[language] || bits.en;
  return list.length ? list.join(' ') : null;
}

// Facts worth a note at all: something happened this week.
export function hasWeekFacts(facts) {
  return Boolean(facts.attendance_week?.total || facts.homework_week?.assigned || facts.marks_week?.length);
}

// ---------- B1: daily plan ----------

// Candidates arrive already scored by the SQL that found them. Picks the
// top n by priority, at most one per kind, so the plan is varied.
export function pickPlanItems(candidates, n = 3) {
  const seen = new Set();
  const out = [];
  for (const c of [...candidates].sort((a, b) => b.priority - a.priority)) {
    if (seen.has(c.kind)) continue;
    seen.add(c.kind);
    out.push(c);
    if (out.length === n) break;
  }
  return out;
}

export function planWhatsAppLine(items) {
  return toTemplateParam(
    items
      .map((it, i) => `${i + 1}) ${it.title}${it.action_id ? ` (reply APPROVE ${it.action_id})` : ''}`)
      .join(' | '),
    900
  );
}
