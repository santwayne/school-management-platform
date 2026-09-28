import test from 'node:test';
import assert from 'node:assert/strict';
import { consentKeyword } from '../utils/consent.js';

test('STOP variants opt out', () => {
  for (const t of ['STOP', 'stop', ' Stop. ', 'unsubscribe', 'band karo', 'mat bhejo', 'ਬੰਦ ਕਰੋ', 'बंद करो']) {
    assert.equal(consentKeyword(t), 'stop', t);
  }
});

test('START variants opt back in', () => {
  for (const t of ['START', 'start!', 'subscribe', 'shuru karo']) assert.equal(consentKeyword(t), 'start', t);
});

test('sentences that merely contain the word are not opt-outs', () => {
  for (const t of ['bus stop kahan hai?', 'stop the bus near my house', 'fees kitni baaki hai', '', null]) {
    assert.equal(consentKeyword(t), null, String(t));
  }
});
