import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowHistory, buildRequest, TUTOR_RULES } from '../services/tutorService.js';
import { costInr, priceFor, totalTokens } from '../services/aiUsage.js';

const turns = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));

test('windowHistory keeps short sessions whole', () => {
  assert.equal(windowHistory(turns(10), 12, 8).length, 10);
  assert.equal(windowHistory(turns(12), 12, 8).length, 12);
});

test('windowHistory jumps in blocks, keeps 12-20 messages, starts on a student turn', () => {
  for (let n = 13; n <= 60; n++) {
    const w = windowHistory(turns(n), 12, 8);
    assert.ok(w.length >= 12 && w.length < 20, `n=${n} kept ${w.length}`);
    assert.equal(w[0].role, 'user', `n=${n}`);
    assert.deepEqual(w[w.length - 1], turns(n)[n - 1]);
  }
  // same start for several turns in a row (stable cached prefix)
  const a = windowHistory(turns(20), 12, 8)[0].content;
  const b = windowHistory(turns(26), 12, 8)[0].content;
  assert.equal(a, b);
});

test('shared cached rules contain no student data; student block carries memory', () => {
  const req = buildRequest(turns(4), 'help', 'Maths', '6', 'Strengths: fractions');
  assert.equal(req.system[0].text, TUTOR_RULES);
  assert.ok(!req.system[0].text.includes('fractions'));
  assert.ok(req.system[1].text.includes('Strengths: fractions'));
  assert.ok(req.system[1].text.includes('Grade/class: 6'));
  assert.ok(req.system.every((b) => b.cache_control?.type === 'ephemeral'));
  const last = req.messages[req.messages.length - 1];
  assert.deepEqual(last, { role: 'user', content: 'help' });
  const prev = req.messages[req.messages.length - 2];
  assert.equal(prev.content[0].cache_control.type, 'ephemeral');
});

test('full student memory is passed through untouched', () => {
  const memory = 'x'.repeat(5000);
  const req = buildRequest([], 'hi', 'Science', '8', memory);
  assert.ok(req.system[1].text.includes(memory));
});

test('cost math: cache reads are 10% of input price, writes 125%', () => {
  process.env.USD_INR = '88';
  assert.equal(priceFor('claude-haiku-4-5-20251001').input, 1);
  assert.equal(costInr('claude-haiku-4-5', { input_tokens: 1_000_000 }), 88);
  assert.equal(costInr('claude-haiku-4-5', { cache_read_input_tokens: 1_000_000 }), 8.8);
  assert.equal(costInr('claude-haiku-4-5', { cache_creation_input_tokens: 1_000_000 }), 110);
  assert.equal(costInr('claude-haiku-4-5', { output_tokens: 1_000_000 }), 440);
  assert.equal(costInr('some-unknown-model', { input_tokens: 1_000_000 }), 264);
  assert.equal(totalTokens({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }), 10);
});
