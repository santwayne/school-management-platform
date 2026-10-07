import test from 'node:test';
import assert from 'node:assert/strict';
import { classLabel } from '../utils/classLabel.js';
import { reminderTopic } from '../services/teachingReminderService.js';
import { parentMessageIsForAdmissions } from '../services/admissionAgent.js';

test('class label never repeats the section', () => {
  assert.equal(classLabel('Class 6A', 'A'), 'Class 6A'); // was "Class 6A A"
  assert.equal(classLabel('Class 6', 'A'), 'Class 6 A');
  assert.equal(classLabel('Class 6a', 'A'), 'Class 6a');
  assert.equal(classLabel('Class 6', null), 'Class 6');
  assert.equal(classLabel('Class 6', '  '), 'Class 6');
  assert.equal(classLabel(' Nursery ', 'Rose'), 'Nursery Rose');
});

test('class reminder topic reads naturally after "Topic:" and has no full stop of its own', () => {
  assert.equal(reminderTopic({ planTitle: 'Exercise 8.4' }), 'Exercise 8.4');
  assert.equal(reminderTopic({ planTitle: ' Fractions\n revision. ' }), 'Fractions revision');
  assert.equal(reminderTopic({ planTitle: 'Fractions', coveringFor: 'Amanpreet Singh' }), 'Fractions (covering for Amanpreet Singh)');
  assert.equal(reminderTopic({}), 'not logged yet');
  assert.equal(reminderTopic({ coveringFor: 'Amanpreet Singh' }), 'not logged yet (covering for Amanpreet Singh)');
  for (const t of [reminderTopic({}), reminderTopic({ planTitle: 'A.' }), reminderTopic({ coveringFor: 'B' })]) assert.ok(!/\.$/.test(t));
});

test('a known parent: admission words always go to the admission assistant', () => {
  for (const text of ['I want to book a campus visit', 'mai campus visit krna', 'Admission for my younger daughter', 'new admission kab se hai', 'dakhila karwana hai', 'दाखिला चाहिए', 'school tour possible?']) {
    assert.equal(parentMessageIsForAdmissions({ text }), true, text);
  }
});

test('a known parent: ordinary school messages stay with the parent assistant', () => {
  for (const text of ['fees kitni baaki hai', 'what is the homework today', 'Aarav is absent tomorrow, doctor visit', 'bus kahan hai', 'what is photosynthesis', '2', 'yes']) {
    assert.equal(parentMessageIsForAdmissions({ text }), false, text);
  }
  assert.equal(parentMessageIsForAdmissions({ text: '' }), false);
});

test('a known parent with an open enquiry: replies continue the admission chat', () => {
  const idle = { convo_state: {}, recent_inbound: false, recent_outbound: false };
  assert.equal(parentMessageIsForAdmissions({ text: 'what is the homework today', enquiry: idle }), false);
  assert.equal(parentMessageIsForAdmissions({ text: 'can we visit on saturday', enquiry: idle }), true);
  // just been talking to the admission assistant
  assert.equal(parentMessageIsForAdmissions({ text: '2', enquiry: { ...idle, recent_inbound: true } }), true);
  // it offered slots a moment ago
  assert.equal(parentMessageIsForAdmissions({ text: '2', enquiry: { convo_state: { offered_slot_ids: [4, 5] }, recent_inbound: false, recent_outbound: true } }), true);
  // short reply right after our follow-up
  assert.equal(parentMessageIsForAdmissions({ text: 'yes', enquiry: { ...idle, recent_outbound: true } }), true);
  // a question left unanswered for hours must not capture later messages
  assert.equal(parentMessageIsForAdmissions({ text: 'fees kitni baaki hai', enquiry: { convo_state: { awaiting: 'applying_grade' }, recent_inbound: false, recent_outbound: false } }), false);
  // a long, unrelated message right after a follow-up stays with the parent assistant
  assert.equal(parentMessageIsForAdmissions({ text: 'Please tell me how much fee is pending for Aarav this term', enquiry: { ...idle, recent_outbound: true } }), false);
});
