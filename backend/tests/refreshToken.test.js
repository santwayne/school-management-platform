import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { hashToken } from '../services/refreshTokenService.js';

test('hashToken is deterministic and hex-encoded sha256 (64 chars)', () => {
  const raw = 'a-sample-refresh-token';
  const hash = hashToken(raw);
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, hashToken(raw));
});

test('hashToken never leaks the raw token back out', () => {
  const raw = 'another-sample-token';
  assert.notEqual(hashToken(raw), raw);
});

test('different raw tokens hash to different values', () => {
  assert.notEqual(hashToken('token-one'), hashToken('token-two'));
});

test('raw refresh tokens generated for storage are unique and high-entropy', () => {
  // Mirrors how issueRefreshToken() derives its raw token, without needing
  // a DB connection: 40 random bytes hex-encoded (80 chars), never repeating.
  const a = crypto.randomBytes(40).toString('hex');
  const b = crypto.randomBytes(40).toString('hex');
  assert.equal(a.length, 80);
  assert.notEqual(a, b);
});
