import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absenceAlertErrorSummary } from '../utils/absenceAlertSummary.js';

test('all sent, nobody unreachable → no error text', () => {
  assert.equal(absenceAlertErrorSummary([{ whatsapp_status: 'SENT' }], []), null);
});

test('WhatsApp permission failure is shown, not left blank', () => {
  const s = absenceAlertErrorSummary(
    [{ whatsapp_status: 'FAILED', error: '(#200) You do not have the necessary permissions to send messages on behalf of this WhatsApp Business Account' }], []);
  assert.match(s, /^1 WhatsApp send failed: \(#200\) You do not have the necessary permissions/);
});

test('unreachable parents are explained by reason, failures de-duplicated', () => {
  const s = absenceAlertErrorSummary(
    [{ whatsapp_status: 'FAILED', error: 'boom' }, { whatsapp_status: 'ERROR', error: 'boom' }, { whatsapp_status: 'SENT' }],
    [{ reason: 'no_parent_linked' }, { reason: 'no_parent_linked' }, { reason: 'parent_not_opted_in' }]);
  assert.equal(s, '2 WhatsApp sends failed: boom; 2 students have no parent linked; 1 parent has not opted in to WhatsApp');
});

test('failure without a message still says something', () => {
  assert.match(absenceAlertErrorSummary([{ whatsapp_status: 'FAILED' }], []), /unknown error/);
});
