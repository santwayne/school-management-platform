// Human-readable reason for an absence-alert run that wasn't fully
// successful — shown in Control Center → Automations → "Error" column.
// Before this, failed runs were recorded with no error at all, so the
// operator couldn't tell a WhatsApp permission problem from a student who
// simply has no parent linked.
const REASON_TEXT = {
  no_parent_linked: (n) => `${n} student${n === 1 ? ' has' : 's have'} no parent linked`,
  parent_not_opted_in: (n) => `${n} parent${n === 1 ? ' has' : 's have'} not opted in to WhatsApp`,
};

export function absenceAlertErrorSummary(notifications = [], unreachable = []) {
  const parts = [];
  const failed = notifications.filter((n) => n.whatsapp_status !== 'SENT');
  if (failed.length) {
    const reasons = [...new Set(failed.map((n) => (n.error || 'unknown error').trim()))];
    parts.push(`${failed.length} WhatsApp send${failed.length === 1 ? '' : 's'} failed: ${reasons.slice(0, 3).join(' | ')}`);
  }
  const byReason = {};
  for (const u of unreachable) byReason[u.reason || 'unknown'] = (byReason[u.reason || 'unknown'] || 0) + 1;
  for (const [reason, n] of Object.entries(byReason)) {
    parts.push(REASON_TEXT[reason] ? REASON_TEXT[reason](n) : `${n} parent${n === 1 ? '' : 's'} unreachable (${reason})`);
  }
  const text = parts.join('; ');
  return text ? text.slice(0, 500) : null;
}
