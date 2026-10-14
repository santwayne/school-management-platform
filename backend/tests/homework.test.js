import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateHomeworkInput, isRealDate, HomeworkError } from '../services/homeworkService.js';
import pool from '../config/db.js';

after(async () => pool.end());

const today = '2026-10-06';
const base = { class_id: 3, subject_id: '7', title: 'Read chapter 4' };

test('accepts a normal homework and returns tidy values', () => {
  const v = validateHomeworkInput({ ...base, description: '  pages 40-45 ', due_date: '2026-10-08' }, { today });
  assert.deepEqual(v, { classId: 3, subjectId: 7, title: 'Read chapter 4', description: 'pages 40-45', dueDate: '2026-10-08', attachmentUrl: null, attachmentName: null });
});

test('an attachment must live in this school\'s teaching-media bucket path', () => {
  process.env.AWS_S3_BUCKET = 'test-bucket';
  const ok = 'https://test-bucket.s3.ap-south-1.amazonaws.com/teaching/5/1-ab-sheet.pdf';
  const v = validateHomeworkInput({ ...base, attachment_url: ok, attachment_name: 'sheet.pdf' }, { today, schoolId: 5 });
  assert.equal(v.attachmentUrl, ok);
  assert.equal(v.attachmentName, 'sheet.pdf');
  assert.throws(() => validateHomeworkInput({ ...base, attachment_url: 'https://evil.example/x.pdf' }, { today, schoolId: 5 }), /upload/i);
  assert.throws(() => validateHomeworkInput({ ...base, attachment_url: ok }, { today, schoolId: 6 }), /upload/i);
});

test('title is kept on one line (WhatsApp variables cannot contain new lines or tabs)', () => {
  assert.equal(validateHomeworkInput({ ...base, title: '  Read\n\tchapter   4 ' }, { today }).title, 'Read chapter 4');
});

test('due date is optional, may be today, may not be in the past', () => {
  assert.equal(validateHomeworkInput(base, { today }).dueDate, null);
  assert.equal(validateHomeworkInput({ ...base, due_date: today }, { today }).dueDate, today);
  assert.throws(() => validateHomeworkInput({ ...base, due_date: '2026-10-05' }, { today }), /past/);
});

test('rejects things a teacher can fix, with a 400 and a plain message', () => {
  for (const [body, re] of [
    [{ ...base, class_id: '' }, /class/i],
    [{ ...base, subject_id: 'maths' }, /subject/i],
    [{ ...base, title: '   ' }, /title/i],
    [{ ...base, title: 'x'.repeat(256) }, /title/i],
    [{ ...base, description: 'x'.repeat(2001) }, /details/i],
    [{ ...base, due_date: '08/10/2026' }, /valid date/i],
    [{ ...base, due_date: '2026-02-31' }, /valid date/i],
  ]) {
    assert.throws(() => validateHomeworkInput(body, { today }), (err) => err instanceof HomeworkError && err.status === 400 && re.test(err.message));
  }
});

test('isRealDate', () => {
  assert.equal(isRealDate('2028-02-29'), true);
  assert.equal(isRealDate('2026-02-29'), false);
  assert.equal(isRealDate('2026-13-01'), false);
  assert.equal(isRealDate(''), false);
});
