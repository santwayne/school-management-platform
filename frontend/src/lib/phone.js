// Mirrors backend/utils/phone.js — kept in sync deliberately (same rules,
// same India-only default) so a form can reject/format a bad number before
// it's even submitted, instead of round-tripping to the server first. The
// server still re-validates (never trust client-side alone) — this is just
// for immediate feedback in the UI.

const DEFAULT_COUNTRY_CODE = '91';

export function normalizePhone(raw, defaultCountry = DEFAULT_COUNTRY_CODE) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (hadPlus) {
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  const withoutTrunkPrefix = digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;

  if (withoutTrunkPrefix.length === 10) {
    return `+${defaultCountry}${withoutTrunkPrefix}`;
  }

  if (digits.length === 12 && digits.startsWith(defaultCountry)) {
    return `+${digits}`;
  }

  return null;
}
