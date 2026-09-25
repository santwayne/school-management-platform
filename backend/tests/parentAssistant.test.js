import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { keywordIntent, parseLeaveDates, certificateType, resolveChild, replyLanguage } from '../services/parentAssistant.js';
import pool from '../config/db.js';
import { connection } from '../config/queue.js';

after(async () => {
  await pool.end();
  connection.disconnect();
});

test('keywordIntent routes common parent messages', () => {
  const cases = {
    'fees kitni baaki hai?': 'fee_balance',
    'payment link bhejo': 'pay_now',
    'receipt chahiye': 'fee_receipt',
    'aaj ka homework kya hai': 'homework_today',
    'attendance batao': 'attendance',
    'result aa gaya?': 'results',
    'Aman kal nahi aayega': 'leave_request',
    'chutti kab hai': 'holidays_events',
    'bus kahan hai': 'bus_location',
    'TC chahiye': 'certificate_request',
    'class teacher se baat karni hai': 'talk_to_teacher',
    'mujhe shikayat karni hai': 'complaint',
    'menu': 'menu',
    'thank you': 'thanks',
  };
  for (const [text, want] of Object.entries(cases)) assert.equal(keywordIntent(text), want, text);
  assert.equal(keywordIntent('photosynthesis kya hota hai?'), null, 'subject questions go to the doubt bot');
});

test('safety always wins over other keywords', () => {
  assert.equal(keywordIntent('bus mein ek ladka use maarta hai'), 'safety');
  assert.equal(keywordIntent('my son is being bullied, fees bhi pending hai'), 'safety');
  assert.equal(keywordIntent('उसे किसी ने मारा'), 'safety');
});

test('parseLeaveDates', () => {
  const today = '2026-09-24';
  assert.deepEqual(parseLeaveDates('kal nahi aayega', today), { from: '2026-09-25', to: '2026-09-25' });
  assert.deepEqual(parseLeaveDates('aaj nahi aayegi', today), { from: '2026-09-24', to: '2026-09-24' });
  assert.deepEqual(parseLeaveDates('parso', today), { from: '2026-09-26', to: '2026-09-26' });
  assert.deepEqual(parseLeaveDates('kal se 3 din nahi aayega', today), { from: '2026-09-25', to: '2026-09-27' });
  assert.deepEqual(parseLeaveDates('28/9 to 30/9', today), { from: '2026-09-28', to: '2026-09-30' });
  assert.deepEqual(parseLeaveDates('5/1', today), { from: '2027-01-05', to: '2027-01-05' }, 'past date means next year');
  assert.equal(parseLeaveDates('nahi aayega', today), null);
  assert.equal(parseLeaveDates('45/13', today), null);
});

test('certificateType', () => {
  assert.equal(certificateType('TC chahiye'), 'leaving_certificate');
  assert.equal(certificateType('character certificate'), 'character_certificate');
  assert.equal(certificateType('bonafide'), 'bonafide');
  assert.equal(certificateType('certificate chahiye'), 'bonafide');
});

test('resolveChild', () => {
  const kids = [{ id: 1, name: 'Aman Singh' }, { id: 2, name: 'Riya Singh' }];
  assert.equal(resolveChild([kids[0]], 'fees?', null).child.id, 1);
  assert.equal(resolveChild(kids, 'Riya ki fees', null).child.id, 2);
  assert.equal(resolveChild(kids, 'fees?', 1).child.id, 1, 'remembers the child from earlier');
  assert.equal(resolveChild(kids, 'fees?', null).ask, true);
  assert.equal(resolveChild(kids, 'Aman aur Riya dono ki fees', null).ask, true, 'both named: ask');
});

test('replyLanguage keeps the conversation language for short messages', () => {
  assert.equal(replyLanguage('attendance batao', null, 'hi'), 'hinglish');
  assert.equal(replyLanguage('menu', null, 'hi'), 'hinglish');
  assert.equal(replyLanguage('menu', null, 'en'), 'en');
  assert.equal(replyLanguage('1', 'en', 'hi'), 'en');
  assert.equal(replyLanguage('When is the next holiday?', 'hinglish', 'hi'), 'en');
  assert.equal(replyLanguage('फीस कितनी है', null, 'en'), 'hi');
});
