import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deliveryOutcome, deliveryError } from '../utils/deliveryStatus.js';
import { digestPhoneClash } from '../utils/digestPhone.js';
import { formatAmount } from '../utils/messageFormat.js';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('a webhook status maps to what we record', () => {
  assert.equal(deliveryOutcome('failed'), 'failed');
  assert.equal(deliveryOutcome('delivered'), 'delivered');
  assert.equal(deliveryOutcome('read'), 'read');
  assert.equal(deliveryOutcome('sent'), null);
  assert.equal(deliveryOutcome(undefined), null);
});

test("Meta's reason is kept short and readable", () => {
  assert.equal(
    deliveryError({ errors: [{ code: 131026, title: 'Message undeliverable', error_data: { details: 'Recipient is not a WhatsApp user.' } }] }),
    'Message undeliverable: Recipient is not a WhatsApp user.'
  );
  assert.equal(deliveryError({ errors: [{ title: 'Re-engagement message', message: 'Re-engagement message' }] }), 'Re-engagement message');
  assert.equal(deliveryError({}), null);
});

test('the webhook records delivery for notifications and absence alerts, not only broadcasts', () => {
  const hook = read('../routes/whatsapp.js');
  assert.match(hook, /await recordDeliveryStatus\(s\)/);
  assert.match(hook, /UPDATE dashboard_notifications\s+SET whatsapp_status = \$1/);
  assert.match(hook, /UPDATE notification_log nl SET status = 'FAILED'/);
  assert.match(hook, /'whatsapp\.delivery_failed'/);
  assert.match(read('../routes/attendance.js'), /INSERT INTO notification_log \(attendance_id, parent_id, type, status, wa_message_id, delivery_error\)/);
  assert.match(read('../models/schema.sql'), /ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS wa_message_id/);
});

test('a report number cannot be the school\'s own WhatsApp number', () => {
  const school = '+91 62805 47256';
  assert.match(digestPhoneClash({ operator: '+919988584930', principal: '+916280547256', schoolNumber: school }), /^Principal's WhatsApp number is the school's own/);
  assert.match(digestPhoneClash({ operator: '6280547256', principal: '916280547256', schoolNumber: school }), /^Operator's and Principal's/);
  assert.equal(digestPhoneClash({ operator: '+919988584930', principal: '+917087064479', schoolNumber: school }), null);
  assert.equal(digestPhoneClash({ operator: '+919988584930', principal: null, schoolNumber: school }), null);
  assert.equal(digestPhoneClash({ operator: '+919988584930', principal: '+916280547256', schoolNumber: null }), null);
  assert.match(read('../routes/ops.js'), /digestPhoneClash\(\{ operator: op, principal: pr/);
});

test('money in a message has no stray paise', () => {
  assert.equal(formatAmount('500.00'), '500'); // was "Rs. 500.00"
  assert.equal(formatAmount('1250.50'), '1,250.50');
  assert.equal(formatAmount(100000), '1,00,000');
  assert.equal(formatAmount(null), '0');
  assert.match(read('../workers/pettyCashReminderWorker.js'), /amount: formatAmount\(request\.amount\)/);
});
