import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { gradeKey, detectLanguage, parseYesNo, quickIntent, nextMissingField, ruleExtract, gradeLabel, copyFor } from '../services/admissionAgent.js';
import followupWorker, { followupPlan, hoursUntilNext } from '../workers/admissionFollowupWorker.js';
import pool from '../config/db.js';
import { connection } from '../config/queue.js';

after(async () => {
  await followupWorker.close();
  await pool.end();
  connection.disconnect();
});

test('gradeKey understands how parents write classes', () => {
  const cases = {
    'Class 3': '3', '3rd': '3', '3rd class': '3', 'third': '3', 'III': '3', 'class iii': '3', 'Class 8A': '8',
    'UKG': 'UKG', 'upper kg': 'UKG', 'LKG': 'LKG', 'Nursery': 'NURSERY', 'pre-nursery': 'PRE-NURSERY', 'playgroup': 'PRE-NURSERY',
    '12th': '12', 'कक्षा 3': '3',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(gradeKey(input), want, input);
  assert.equal(gradeKey('hello'), null);
  assert.equal(gradeKey('15'), null);
  assert.equal(gradeKey('I want admission'), null, 'the word "I" is not class 1');
});

test('detectLanguage', () => {
  assert.equal(detectLanguage('नमस्ते'), 'hi');
  assert.equal(detectLanguage('ਸਤ ਸ੍ਰੀ ਅਕਾਲ'), 'pa');
  assert.equal(detectLanguage('fee kitni hai'), 'hinglish');
  assert.equal(detectLanguage('What is the fee?'), 'en');
  assert.equal(copyFor('pa'), copyFor('hi'));
});

test('parseYesNo', () => {
  for (const y of ['yes', 'haan chahiye', 'ji', 'Haan']) assert.equal(parseYesNo(y), true, y);
  for (const n of ['no', 'nahi', 'nahi chahiye', 'not required']) assert.equal(parseYesNo(n), false, n);
  assert.equal(parseYesNo('maybe later'), null);
});

test('quickIntent', () => {
  assert.equal(quickIntent('STOP'), 'opt_out');
  assert.equal(quickIntent('2'), 'choose_option');
  assert.equal(quickIntent('fee kitni hai?'), 'ask_fee');
  assert.equal(quickIntent('please call me'), 'wants_human');
  assert.equal(quickIntent('Aarav'), null);
});

test('ruleExtract never turns a question into a name', () => {
  assert.deepEqual(ruleExtract('fee kitni hai?', 'child_name'), {});
  assert.deepEqual(ruleExtract('Aarav', 'child_name'), { child_name: 'Aarav' });
  assert.deepEqual(ruleExtract('mera naam rohit sharma hai', 'parent_name'), { parent_name: 'Rohit Sharma' });
  assert.deepEqual(ruleExtract('haan', 'needs_transport'), { needs_transport: true });
  assert.equal(ruleExtract('3rd', 'applying_grade').applying_class, '3rd');
  assert.equal(ruleExtract('admission for UKG', null).applying_class, 'admission for UKG');
});

test('nextMissingField walks the question order', () => {
  assert.equal(nextMissingField({}), 'applying_grade');
  assert.equal(nextMissingField({ applying_grade: '3', child_name: 'A', parent_name: 'B', locality: 'C' }), 'needs_transport');
  assert.equal(nextMissingField({ applying_grade: '3', child_name: 'A', parent_name: 'B', locality: 'C', needs_transport: false }), null);
  assert.equal(gradeLabel('3'), 'Class 3');
});

test('follow-up plan', () => {
  assert.deepEqual(followupPlan('7,1,3'), [1, 3, 7]);
  assert.deepEqual(followupPlan('junk'), [1, 3, 7]);
  assert.equal(hoursUntilNext([1, 3, 7], 0), 24);
  assert.equal(hoursUntilNext([1, 3, 7], 1), 48);
  assert.equal(hoursUntilNext([1, 3, 7], 2), 96);
  assert.equal(hoursUntilNext([1, 3, 7], 3), null);
});
