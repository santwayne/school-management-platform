import React from 'react';

// Shared bits for the Admissions screens — mirrors components/ops/opsUi.jsx's
// pattern (same design tokens, same helper shapes) so this feature reads as
// part of the same app, not a bolted-on one.

export const STAGES = ['new', 'qualifying', 'qualified', 'visit_booked', 'visited', 'applied', 'approved', 'admitted', 'lost'];

export const STAGE_LABELS = {
  new: 'New',
  qualifying: 'Qualifying',
  qualified: 'Qualified',
  visit_booked: 'Visit booked',
  visited: 'Visited',
  applied: 'Applied',
  approved: 'Approved',
  admitted: 'Admitted',
  lost: 'Lost',
};

// Kanban only shows the "in flight" stages — admitted/lost are outcomes,
// shown as counts elsewhere rather than columns that just accumulate forever.
export const KANBAN_STAGES = ['new', 'qualifying', 'qualified', 'visit_booked', 'visited', 'applied', 'approved'];

export const SOURCE_LABELS = {
  web_form: 'Website',
  whatsapp: 'WhatsApp',
  walk_in: 'Walk-in',
  phone: 'Phone',
  meta_lead: 'Meta ad',
};

export function timeAgo(value) {
  if (!value) return 'never';
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{message}</div>;
}

export function Notice({ message }) {
  if (!message) return null;
  return <div className="rounded-xl bg-joy-leaf/15 border border-joy-leaf/40 px-4 py-2.5 text-sm text-ink">{message}</div>;
}

export function PageTitle({ title, subtitle, right }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-ink-soft mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function SourceChip({ source }) {
  return <span className="inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-cream-deep/60 text-ink-soft">{SOURCE_LABELS[source] || source}</span>;
}
