import React from 'react';

// Shared bits for the Operator Control Center screens.

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

export const SEVERITY = {
  critical: { label: 'Critical', chip: 'bg-destructive/15 text-destructive', bar: 'bg-destructive' },
  high: { label: 'High', chip: 'bg-terracotta/15 text-terracotta-deep', bar: 'bg-terracotta' },
  medium: { label: 'Medium', chip: 'bg-amber-warm/30 text-ink', bar: 'bg-amber-warm' },
  low: { label: 'Low', chip: 'bg-cream-deep text-ink-soft', bar: 'bg-cream-deep' },
};

export function SeverityChip({ severity }) {
  const s = SEVERITY[severity] || SEVERITY.low;
  return <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold ${s.chip}`}>{s.label}</span>;
}

// Green / amber / red status dot, with a text label for screen readers
// and for colour-blind operators (colour never carries meaning alone).
const LIGHT = {
  green: { dot: 'bg-joy-leaf', label: 'Working' },
  amber: { dot: 'bg-amber-warm', label: 'Check' },
  red: { dot: 'bg-destructive', label: 'Failing' },
  idle: { dot: 'bg-cream-deep ring-1 ring-ink-soft/30', label: 'Waiting' },
};
export function Light({ light, showLabel = false }) {
  const l = LIGHT[light] || LIGHT.amber;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${l.dot}`} aria-hidden="true" />
      <span className={showLabel ? 'text-xs text-ink-soft' : 'sr-only'}>{l.label}</span>
    </span>
  );
}

const INTEGRATION_LIGHT = { ok: 'green', degraded: 'amber', down: 'red', not_configured: null };
export function integrationLight(status) {
  return INTEGRATION_LIGHT[status];
}

export const INTEGRATION_NAMES = {
  postgres: 'Database',
  redis: 'Background jobs',
  whatsapp: 'WhatsApp',
  anthropic: 'AI',
  razorpay: 'Online payments',
  vapi: 'Voice calls',
  s3: 'File storage',
  gps: 'Bus GPS',
  biometric: 'Biometric',
};

export function ErrorBanner({ message }) {
  if (!message) return null;
  return <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{message}</div>;
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
