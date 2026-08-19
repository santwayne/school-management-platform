// Item 7 of the QA fix list: there was no shared phone normalization
// anywhere in the codebase, so parent/staff phone numbers got stored
// exactly as hand-typed — "98765 43210", "09876543210", "9876543210", etc.
// Meta's WhatsApp Cloud API requires strict E.164 (+91XXXXXXXXXX); anything
// else silently fails to send with no useful error at the point the number
// was actually entered (see whatsappService.js).
//
// This is intentionally India-only (defaultCountry='91') — every phone
// field in this codebase (parents, teachers) is Indian-market, same
// assumption whatsappService.js's hi/pa language defaults already make.

const DEFAULT_COUNTRY_CODE = '91';

/**
 * Normalizes a raw, human-typed phone number into strict E.164
 * (+<countrycode><digits>, no spaces/dashes/parens).
 *
 * Returns the normalized string, or null if the input can't be confidently
 * normalized — callers should reject the request (400) rather than store a
 * guess that might silently fail to send later.
 */
export function normalizePhone(raw, defaultCountry = DEFAULT_COUNTRY_CODE) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (hadPlus) {
    // Already had a leading + — trust the country code as typed, just
    // sanity-check the overall length (E.164 allows up to 15 digits).
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  // Local dialing prefix ("0" + 10-digit number) — strip it before checking
  // the bare-10-digit case below.
  const withoutTrunkPrefix = digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;

  // Bare 10-digit number, no country code at all — the common case for a
  // hand-typed Indian mobile number.
  if (withoutTrunkPrefix.length === 10) {
    return `+${defaultCountry}${withoutTrunkPrefix}`;
  }

  // Country code already present but no leading + (e.g. "919876543210").
  if (digits.length === 12 && digits.startsWith(defaultCountry)) {
    return `+${digits}`;
  }

  return null;
}
