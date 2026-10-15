import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTemplateParam, EMPTY_TEMPLATE_VALUE } from '../services/whatsappService.js';

// B2: Meta error 131008 — an empty variable is never sent.
test('empty, blank and missing values become "-"', () => {
  for (const v of ['', '   ', '\n\t', null, undefined]) {
    assert.equal(cleanTemplateParam(v), EMPTY_TEMPLATE_VALUE);
  }
});

// B3: Meta error #100 — no new lines, tabs or runs of spaces.
test('new lines, tabs and repeated spaces are flattened to single spaces', () => {
  assert.equal(cleanTemplateParam('Line one\nLine two\r\n\tLine    three'), 'Line one Line two Line three');
  assert.equal(cleanTemplateParam('  padded  '), 'padded');
  assert.doesNotMatch(cleanTemplateParam('a\n\n\nb     c'), /[\n\t]| {2,}/);
});

test('numbers and ordinary text pass through unchanged', () => {
  assert.equal(cleanTemplateParam(16), '16');
  assert.equal(cleanTemplateParam(0), '0');
  assert.equal(cleanTemplateParam('Maths — Chapter 4'), 'Maths — Chapter 4');
});

test('very long values are trimmed under Meta\'s limit', () => {
  const out = cleanTemplateParam('x'.repeat(5000));
  assert.ok(out.length <= 1000);
  assert.ok(out.endsWith('…'));
});
