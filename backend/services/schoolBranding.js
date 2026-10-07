import { GetObjectCommand } from '@aws-sdk/client-s3';
import pool from '../config/db.js';
import { s3, s3PublicUrl } from '../utils/s3.js';

// ------------------------------------------------------------------
// A school's own look on the documents it issues: its logo and one theme
// colour, set by the principal in Settings -> Branding. Used by the
// certificate PDFs, the payslip PDF and the leaving certificate.
//
// The logo is only ever read from OUR bucket (it got there through
// POST /api/settings/logo). A logo_url pointing anywhere else is ignored
// here — the server never fetches an arbitrary address a user typed in.
// ------------------------------------------------------------------

export const DEFAULT_BRAND_COLOR = '#333333'; // the neutral the PDFs used before

// '#RRGGBB' (lower-case) or null. Accepts '#abc' shorthand and a missing '#'.
export function normalizeBrandColor(value) {
  let v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

// Text printed in the theme colour must stay readable on white paper. A very
// pale colour (yellow, cream) is darkened until it is; dark ones are untouched.
export function readableOnWhite(hex) {
  const c = normalizeBrandColor(hex);
  if (!c) return DEFAULT_BRAND_COLOR;
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const luminance = () => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  let guard = 0;
  while (luminance() > 0.55 && guard++ < 20) {
    r = Math.round(r * 0.9); g = Math.round(g * 0.9); b = Math.round(b * 0.9);
  }
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

// pdfkit and jsPDF can only place PNG and JPEG images.
export function imageKind(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  return null;
}

// The S3 key of a logo stored in our bucket, or null for any other URL.
export function ownBucketKey(url) {
  if (!url || !process.env.AWS_S3_BUCKET) return null;
  const prefix = s3PublicUrl('');
  if (!String(url).startsWith(prefix)) return null;
  const key = decodeURIComponent(String(url).slice(prefix.length).split('?')[0]);
  return key.startsWith('logos/') && !key.includes('..') ? key : null;
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;
const logoCache = new Map(); // url -> { at, buffer|null }

async function readLogo(url) {
  const key = ownBucketKey(url);
  if (!key) return null;
  const hit = logoCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.buffer;
  let buffer = null;
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key }));
    const chunks = [];
    let size = 0;
    for await (const chunk of out.Body) {
      size += chunk.length;
      if (size > MAX_LOGO_BYTES) throw new Error('logo larger than 2 MB');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    buffer = imageKind(bytes) ? bytes : null; // SVG / WebP / GIF cannot go into a PDF
  } catch (err) {
    console.error(`[branding] could not read logo ${key}:`, err.message);
    buffer = null;
  }
  if (logoCache.size > 200) logoCache.clear();
  logoCache.set(url, { at: Date.now(), buffer });
  return buffer;
}

export function clearBrandingCache() {
  logoCache.clear();
}

/**
 * { color, hasColor, logo, logoKind } for one school.
 *   color     always a usable '#rrggbb' (the school's, or the neutral default)
 *   hasColor  whether the school actually chose one
 *   logo      Buffer (PNG/JPEG) or null
 * Never throws: a document must still be issued when branding cannot be read.
 */
export async function getSchoolBranding(schoolId) {
  const fallback = { color: DEFAULT_BRAND_COLOR, hasColor: false, logo: null, logoKind: null };
  try {
    const r = await pool.query('SELECT logo_url, brand_color FROM school_settings WHERE school_id = $1', [schoolId]);
    const row = r.rows[0];
    if (!row) return fallback;
    const chosen = normalizeBrandColor(row.brand_color);
    const logo = await readLogo(row.logo_url);
    return { color: chosen ? readableOnWhite(chosen) : DEFAULT_BRAND_COLOR, hasColor: Boolean(chosen), logo, logoKind: imageKind(logo) };
  } catch (err) {
    console.error('[branding] lookup failed:', err.message);
    return fallback;
  }
}

// Draws the logo centred at the top of a pdfkit page and moves the cursor
// below it. Returns true when something was drawn. Never throws.
export function drawCenteredLogo(doc, logo, { top, maxWidth = 150, maxHeight = 64 } = {}) {
  if (!logo) return false;
  try {
    const img = doc.openImage(logo);
    const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1.5);
    const w = img.width * scale;
    const h = img.height * scale;
    const y = top ?? doc.y;
    doc.image(img, (doc.page.width - w) / 2, y, { width: w, height: h });
    doc.y = y + h + 8;
    return true;
  } catch (err) {
    console.error('[branding] logo could not be placed in the PDF:', err.message);
    return false;
  }
}
