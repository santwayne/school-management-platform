import { formatNotifyDate } from './notifyDate.js';

// What a teacher reads when the days they are applying for are already
// covered by another of their leave requests.
export function overlapMessage(existing) {
  const from = formatNotifyDate(existing.start_date);
  const to = formatNotifyDate(existing.end_date);
  const when = from === to ? `on ${from}` : `from ${from} to ${to}`;
  const state = existing.status === 'APPROVED' ? 'approved' : 'waiting for approval';
  return `You already have ${existing.leave_type} leave ${when} (${state}). Choose dates that do not overlap it.`;
}
