import test from 'node:test';
import assert from 'node:assert/strict';
import { parentTemplateLanguage, sendWithLanguageFallback, isTemplateLanguageMissing } from '../utils/templateLanguage.js';

const metaError = (code) => Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { error: { code } } } });

test('parentTemplateLanguage keeps hi/pa/en and defaults everything else to hi', () => {
  assert.equal(parentTemplateLanguage('pa'), 'pa');
  assert.equal(parentTemplateLanguage('hi'), 'hi');
  assert.equal(parentTemplateLanguage('en'), 'en');
  assert.equal(parentTemplateLanguage(null), 'hi');
  assert.equal(parentTemplateLanguage('fr'), 'hi');
});

test('sends once in the parent language when that translation is approved', async () => {
  const calls = [];
  const out = await sendWithLanguageFallback(async (lang) => { calls.push(lang); return { id: 1 }; }, 'pa');
  assert.deepEqual(calls, ['pa']);
  assert.deepEqual(out, { result: { id: 1 }, language: 'pa' });
});

test('falls back to English when Meta says the translation does not exist (132001)', async () => {
  const calls = [];
  const out = await sendWithLanguageFallback(async (lang) => {
    calls.push(lang);
    if (lang !== 'en') throw metaError(132001);
    return { id: 2 };
  }, 'hi');
  assert.deepEqual(calls, ['hi', 'en']);
  assert.equal(out.language, 'en');
});

test('does not retry for any other failure (bad token, not connected, param mismatch)', async () => {
  for (const err of [metaError(190), metaError(132000), new Error('WhatsApp is not connected for this school yet.')]) {
    const calls = [];
    await assert.rejects(sendWithLanguageFallback(async (lang) => { calls.push(lang); throw err; }, 'hi'), err);
    assert.deepEqual(calls, ['hi']);
  }
});

test('an English send that fails is not retried', async () => {
  const calls = [];
  await assert.rejects(sendWithLanguageFallback(async (lang) => { calls.push(lang); throw metaError(132001); }, 'en'));
  assert.deepEqual(calls, ['en']);
  assert.equal(isTemplateLanguageMissing(metaError(132001)), true);
});
