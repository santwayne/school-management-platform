import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isoWeekLabel, istToday, istHour, scoreStudent, teacherSignals, fallbackReason, fallbackFirstStep,
  noteProblems, toTemplateParam, noteLanguage, fallbackNote, hasWeekFacts, pickPlanItems, planWhatsAppLine,
} from '../utils/aiAutomation.js';

test('isoWeekLabel matches ISO weeks, including the year boundary', () => {
  assert.equal(isoWeekLabel('2026-10-14'), '2026-W42');
  assert.equal(isoWeekLabel('2026-10-18'), '2026-W42'); // Sunday stays in the same week
  assert.equal(isoWeekLabel('2027-01-01'), '2026-W53');
});

test('istToday / istHour use India time, not the server clock', () => {
  const lateUtc = new Date('2026-10-13T20:00:00Z'); // 01:30 IST on the 14th
  assert.equal(istToday(lateUtc), '2026-10-14');
  assert.equal(istHour(lateUtc), 1);
});

test('a healthy student is not flagged', () => {
  const r = scoreStudent({ att_recent: { present: 10, total: 10 }, att_prior: { present: 20, total: 20 }, marks_recent_pct: 78, marks_prior_pct: 80, hw: { assigned: 4, completed: 4 } });
  assert.equal(r.flagged, false);
  assert.equal(r.score, 0);
});

test('one strong signal alone is not enough (high threshold)', () => {
  const r = scoreStudent({ att_recent: { present: 6, total: 10 } });
  assert.equal(r.score, 2);
  assert.equal(r.flagged, false);
});

test('low attendance + falling marks is flagged with the evidence', () => {
  const r = scoreStudent({ att_recent: { present: 6, total: 10 }, marks_recent_pct: 52, marks_prior_pct: 74 });
  assert.equal(r.flagged, true);
  assert.deepEqual(r.signals.map((s) => s.key).sort(), ['attendance_low', 'marks_drop']);
  assert.match(r.signals.find((s) => s.key === 'attendance_low').evidence, /60% .*6 of 10/);
});

test('an attendance drop counts less when attendance is already flagged as low', () => {
  const r = scoreStudent({ att_recent: { present: 5, total: 10 }, att_prior: { present: 19, total: 20 } });
  assert.equal(r.signals.find((s) => s.key === 'attendance_drop').weight, 1);
  assert.equal(r.score, 3);
  assert.equal(r.flagged, true);
});

test('supporting signals alone never flag, even when they add up', () => {
  const r = scoreStudent({ hw: { assigned: 5, completed: 0 }, leaves_30d: 4, struggles: 3, fee: { due: 12000, days_since_payment: 200 } });
  assert.equal(r.score, 4);
  assert.equal(r.flagged, false);
});

test('too few attendance days are not judged', () => {
  const r = scoreStudent({ att_recent: { present: 1, total: 3 }, absence_streak: 2 });
  assert.equal(r.signals.length, 0);
});

test('fee context is principal-only and never reaches the teacher text', () => {
  const r = scoreStudent({ att_recent: { present: 5, total: 10 }, absence_streak: 3, fee: { due: 8000, days_since_payment: 120 } });
  assert.ok(r.signals.some((s) => s.key === 'fee_overdue' && s.principal_only));
  assert.ok(!teacherSignals(r.signals).some((s) => s.key === 'fee_overdue'));
  assert.doesNotMatch(fallbackReason('Aman', r.signals), /fee|₹/i);
  assert.match(fallbackReason('Aman', r.signals), /^Aman: /);
  assert.equal(fallbackFirstStep(r.signals), 'Call the parent today to check in about the absences.');
});

test('noteProblems catches labels in English, Hinglish, Hindi and Punjabi', () => {
  assert.deepEqual(noteProblems('Riya did well in fractions this week.'), []);
  assert.ok(noteProblems('Riya is weak in maths.').some((p) => p.startsWith('label:')));
  assert.ok(noteProblems('Riya maths mein kamzor hai').some((p) => p.startsWith('label:')));
  assert.ok(noteProblems('रिया गणित में कमज़ोर है').some((p) => p.startsWith('label:')));
  assert.ok(noteProblems('ਰੀਆ ਆਲਸੀ ਹੈ').some((p) => p.startsWith('label:')));
  // Word boundaries: "weakness" in "no weaknesses" style text is still caught only as a word.
  assert.deepEqual(noteProblems('She tackled the weekly quiz.'), []);
  assert.ok(noteProblems('Call 9876543210').includes('phone_number'));
  assert.ok(noteProblems('see https://x.y').includes('link'));
  assert.ok(noteProblems('').includes('empty'));
  assert.ok(noteProblems('a'.repeat(701)).includes('too_long'));
});

test('toTemplateParam removes what WhatsApp templates reject', () => {
  assert.equal(toTemplateParam('Line one\nLine two\t\tthree    four'), 'Line one Line two three four');
});

test('note language: school override or the parent preference', () => {
  assert.equal(noteLanguage('parent', 'pa'), 'pa');
  assert.equal(noteLanguage('parent', undefined), 'hi');
  assert.equal(noteLanguage('en', 'pa'), 'en');
  assert.equal(noteLanguage('hinglish', 'hi'), 'hinglish');
});

test('fallback note uses only the facts and stays positive', () => {
  const facts = { first_name: 'Riya', attendance_week: { present: 5, total: 6 }, homework_week: { assigned: 3, completed: 2 }, strengths: ['step-by-step reasoning'], next_steps: ['10 minutes of fraction practice'] };
  const en = fallbackNote(facts, 'en');
  assert.match(en, /Riya attended 5 of 6 school days/);
  assert.match(en, /Homework done: 2 of 3/);
  assert.match(en, /To help at home: 10 minutes of fraction practice/);
  assert.deepEqual(noteProblems(en), []);
  assert.match(fallbackNote(facts, 'hi'), /6 में से 5 दिन/);
  assert.match(fallbackNote(facts, 'pa'), /6 ਵਿੱਚੋਂ 5 ਦਿਨ/);
  assert.equal(fallbackNote({ first_name: 'X' }, 'en'), null);
});

test('hasWeekFacts: a quiet week gets no note', () => {
  assert.equal(hasWeekFacts({ marks_week: [] }), false);
  assert.equal(hasWeekFacts({ attendance_week: { present: 0, total: 5 } }), true);
});

test('plan picks the top 3 by priority, one per kind', () => {
  const items = pickPlanItems([
    { kind: 'inbox', key: 'a', priority: 95 },
    { kind: 'inbox', key: 'b', priority: 90 },
    { kind: 'fees', key: 'c', priority: 40 },
    { kind: 'attention', key: 'd', priority: 70 },
    { kind: 'payroll', key: 'e', priority: 50 },
  ]);
  assert.deepEqual(items.map((i) => i.key), ['a', 'd', 'e']);
});

test('plan WhatsApp line is one line and tells how to approve', () => {
  const line = planWhatsAppLine([{ title: 'Fix fee reminders', action_id: 12 }, { title: 'Approve payroll' }]);
  assert.equal(line, '1) Fix fee reminders (reply APPROVE 12) | 2) Approve payroll');
  assert.doesNotMatch(line, /\n/);
});
