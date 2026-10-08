// Meta confirms what happened to a WhatsApp message after it accepted it,
// in a "statuses" webhook: sent, delivered, read or failed.
//
// Only broadcasts listened to it. Every other message (fee reminders, leave,
// absence alerts, the daily report) stayed marked "sent" for good, even when
// Meta later said it never reached the phone - so a test could only be
// trusted by reading the server log.

// What a webhook status means for our own records, or null to ignore it.
export function deliveryOutcome(status) {
  if (status === 'failed') return 'failed';
  if (status === 'read') return 'read';
  if (status === 'delivered') return 'delivered';
  return null; // "sent" (already recorded) and anything unknown
}

// Meta's reason, short enough to show on a screen: "Message undeliverable:
// the recipient phone number is not a WhatsApp phone number."
export function deliveryError(status) {
  const e = status?.errors?.[0];
  if (!e) return null;
  const parts = [e.title, e.error_data?.details || e.message].map((p) => String(p ?? '').trim()).filter(Boolean);
  const text = [...new Set(parts)].join(': ');
  return text ? text.slice(0, 500) : null;
}
