import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCount, withoutTrailingFullStop } from '../utils/messageFormat.js';

test('counts and percentages drop a trailing .0', () => {
  assert.equal(formatCount('3.0'), '3'); // staff leave said "3.0 day(s)"
  assert.equal(formatCount('0.0'), '0'); // low attendance said "0.0%"
  assert.equal(formatCount('0.5'), '0.5');
  assert.equal(formatCount('66.666'), '66.7');
  assert.equal(formatCount(45.5), '45.5');
  assert.equal(formatCount(null), '0');
  assert.equal(formatCount('abc'), '0');
});

test('a variable followed by the template\'s own full stop has none of its own', () => {
  assert.equal(withoutTrailingFullStop('Review today’s chapter and assign practice questions.'), 'Review today’s chapter and assign practice questions');
  assert.equal(withoutTrailingFullStop(' Solve Ex 5.2\n Q1-5.. '), 'Solve Ex 5.2 Q1-5');
  assert.equal(withoutTrailingFullStop('Revise fractions'), 'Revise fractions');
  assert.equal(withoutTrailingFullStop(null), '');
});
