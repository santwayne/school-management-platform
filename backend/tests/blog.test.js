import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, parseTags, sanitizeDescription, normalisePost } from '../services/blogContent.js';

test('slugify makes URL-safe slugs', () => {
  assert.equal(slugify('10 Ways to Cut Fee Defaults!'), '10-ways-to-cut-fee-defaults');
  assert.equal(slugify('  Attendance & WhatsApp — a guide  '), 'attendance-and-whatsapp-a-guide');
  assert.equal(slugify('/Blog/My Post/'), 'blog-my-post');
  assert.equal(slugify('!!!'), '');
});

test('parseTags trims, de-duplicates and caps', () => {
  assert.deepEqual(parseTags(' fees, Attendance ,fees,, FEES '), ['fees', 'Attendance']);
  assert.deepEqual(parseTags(['a', ' b ', 'A']), ['a', 'b']);
  assert.equal(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 12);
});

test('sanitizeDescription strips anything executable', () => {
  const out = sanitizeDescription(
    '<h1>Title</h1><p onclick="x()">Hi <script>alert(1)</script><a href="javascript:alert(1)">bad</a> ' +
    '<a href="https://example.com">ok</a> <a href="https://waynur.com/pricing">in</a><img src=x onerror=alert(1)><iframe src="//evil"></iframe></p>'
  );
  assert.ok(!/script|onclick|onerror|javascript:|iframe|<img/i.test(out));
  assert.ok(out.includes('<h2>Title</h2>'));
  assert.ok(out.includes('<a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a>'));
  assert.ok(out.includes('<a href="https://waynur.com/pricing">in</a>'));
});

test('sanitizeDescription drops empty blocks but keeps nested content', () => {
  const out = sanitizeDescription('<p></p><p><br></p><ul><li><br></li><li>Kept <strong>bold</strong></li></ul><ul><li></li></ul><h2> </h2><p>Text <a href="https://waynur.com/x"><em>link</em></a></p>');
  assert.equal(out, '<ul><li>Kept <strong>bold</strong></li></ul><p>Text <a href="https://waynur.com/x"><em>link</em></a></p>');
});

test('normalisePost validates and fills defaults', () => {
  assert.equal(normalisePost({}).error, 'Title is required');
  assert.equal(normalisePost({ title: 'T', description: '<p> </p>' }).error, 'Description is required');
  assert.match(normalisePost({ title: 'T', description: '<p>x</p>', image_url: 'javascript:alert(1)' }).error, /Image/);
  const { value } = normalisePost({ title: 'Fee Reminders on WhatsApp', description: '<p>Body</p>', tags: 'fees, whatsapp' });
  assert.equal(value.slug, 'fee-reminders-on-whatsapp');
  assert.equal(value.meta_title, 'Fee Reminders on WhatsApp');
  assert.deepEqual(value.tags, ['fees', 'whatsapp']);
  assert.equal(value.image_url, null);
});
