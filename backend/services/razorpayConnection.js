import pool from '../config/db.js';
import { encryptSecret, decryptSecret, maskSecret } from '../utils/secretBox.js';
import { razorpayClientFor } from '../utils/razorpay.js';
import { audit } from './opsService.js';

// ------------------------------------------------------------------
// A school's OWN Razorpay account.
//
// School fee money has to land in the school's bank account, so every fee
// payment link, fee reminder link and admission application-fee link is
// created with the school's keys — never with Waynur's platform keys, which
// are only for Waynur's own plan billing (utils/razorpay.js razorpayClient).
//
// Everything a Super Admin does to that connection goes through here
// (routes/superAdmin.js), the same way services/whatsappConnection.js does
// for WhatsApp: check the keys with Razorpay -> save (secrets encrypted).
// There is deliberately NO fallback to the platform keys: a school without
// its own keys gets a clear "not set up" error instead of its parents'
// money quietly arriving in the wrong account.
// ------------------------------------------------------------------

export class RazorpayConnectionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const NOT_CONNECTED_MESSAGE =
  "Online fee payments are not set up for this school yet. Ask Waynur support to connect the school's Razorpay account.";

const KEY_ID_RE = /^rzp_(live|test)_[A-Za-z0-9]{6,40}$/;

export function razorpayKeyMode(keyId) {
  const m = KEY_ID_RE.exec(String(keyId || '').trim());
  return m ? m[1] : null;
}

// The URL the school's Razorpay account must post its webhooks to.
export function schoolWebhookUrl(schoolId) {
  const base = String(process.env.PUBLIC_SITE_URL || 'https://waynur.com').replace(/\/+$/, '');
  return `${base}/api/payment-links/webhook/school/${schoolId}`;
}

export const SCHOOL_WEBHOOK_EVENTS = ['payment_link.paid'];

const schoolIdOf = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// What the Super Admin screen shows. Never includes a secret.
export async function getRazorpayConnection(rawSchoolId) {
  const schoolId = schoolIdOf(rawSchoolId);
  if (!schoolId) throw new RazorpayConnectionError(404, 'School not found');
  const r = await pool.query(
    `SELECT s.id AS school_id, s.name AS school_name,
            c.key_id, c.secret_hint, c.webhook_hint, c.mode, c.last_webhook_at,
            c.created_at AS connected_at, c.updated_at AS keys_updated_at
     FROM schools s
     LEFT JOIN school_razorpay_credentials c ON c.school_id = s.id
     WHERE s.id = $1`,
    [schoolId]
  );
  if (r.rowCount === 0) throw new RazorpayConnectionError(404, 'School not found');
  const row = r.rows[0];
  return {
    ...row,
    connected: Boolean(row.key_id),
    webhook_url: schoolWebhookUrl(schoolId),
    webhook_events: SCHOOL_WEBHOOK_EVENTS,
  };
}

// Small public view for the school's own staff (Settings / Fees screens).
export async function schoolRazorpayStatus(schoolId) {
  const r = await pool.query('SELECT mode FROM school_razorpay_credentials WHERE school_id = $1', [schoolId]);
  return { connected: r.rowCount > 0, mode: r.rows[0]?.mode || null };
}

// Ask Razorpay whether these keys are real. A cheap authenticated read.
async function verifyKeys({ keyId, keySecret }) {
  try {
    await razorpayClientFor({ keyId, keySecret }).get('/payment_links', { params: { count: 1 } });
    return { ok: true };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) return { ok: false, error: 'Razorpay did not accept this Key ID / Key Secret pair.' };
    if (status) {
      return { ok: false, error: err.response?.data?.error?.description || `Razorpay answered with an error (${status}).` };
    }
    return { ok: false, error: 'Could not reach Razorpay to check the keys. Try again in a minute.' };
  }
}

/**
 * Save (or replace) a school's Razorpay keys.
 * key_secret / webhook_secret may be omitted when they are already saved —
 * e.g. only the webhook secret is being rotated — in which case the stored
 * value is kept.
 */
export async function connectSchoolRazorpay({ schoolId: rawSchoolId, keyId, keySecret, webhookSecret, superAdminId = null }) {
  const schoolId = schoolIdOf(rawSchoolId);
  if (!schoolId) throw new RazorpayConnectionError(404, 'School not found');
  const school = await pool.query('SELECT id FROM schools WHERE id = $1', [schoolId]);
  if (school.rowCount === 0) throw new RazorpayConnectionError(404, 'School not found');

  const id = String(keyId || '').trim();
  const mode = razorpayKeyMode(id);
  if (!mode) throw new RazorpayConnectionError(400, 'key_id must be the Razorpay Key ID, starting with rzp_live_ or rzp_test_');

  const existingRes = await pool.query('SELECT key_id, key_secret_enc, webhook_secret_enc FROM school_razorpay_credentials WHERE school_id = $1', [schoolId]);
  const existing = existingRes.rows[0] || null;

  let secret = String(keySecret || '').trim();
  const secretIsNew = Boolean(secret);
  if (!secret) {
    // A different Key ID always needs its own secret.
    if (!existing || existing.key_id !== id) throw new RazorpayConnectionError(400, 'key_secret is required');
    try {
      secret = decryptSecret(existing.key_secret_enc);
    } catch {
      throw new RazorpayConnectionError(400, 'The saved Key Secret can no longer be read — please paste it again.');
    }
  }

  const hook = String(webhookSecret || '').trim();
  const hookIsNew = Boolean(hook);
  if (!hook && !existing) throw new RazorpayConnectionError(400, 'webhook_secret is required — it is the secret you type when adding the webhook in the school\'s Razorpay dashboard');
  if (hookIsNew && hook.length < 8) throw new RazorpayConnectionError(400, 'webhook_secret must be at least 8 characters');
  if (hookIsNew && hook === secret) throw new RazorpayConnectionError(400, 'webhook_secret must not be the same as the Key Secret');

  let hookHint = hookIsNew ? maskSecret(hook) : null;
  if (!hookIsNew) {
    try {
      hookHint = maskSecret(decryptSecret(existing.webhook_secret_enc));
    } catch {
      throw new RazorpayConnectionError(400, 'The saved webhook secret can no longer be read — please type it again.');
    }
  }

  // Prove the keys work before anything is saved.
  const check = await verifyKeys({ keyId: id, keySecret: secret });
  if (!check.ok) throw new RazorpayConnectionError(400, check.error);

  await pool.query(
    `INSERT INTO school_razorpay_credentials (school_id, key_id, key_secret_enc, secret_hint, webhook_secret_enc, webhook_hint, mode, connected_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (school_id) DO UPDATE SET
       key_id = EXCLUDED.key_id,
       key_secret_enc = EXCLUDED.key_secret_enc,
       secret_hint = EXCLUDED.secret_hint,
       webhook_secret_enc = EXCLUDED.webhook_secret_enc,
       webhook_hint = EXCLUDED.webhook_hint,
       mode = EXCLUDED.mode,
       connected_by = EXCLUDED.connected_by,
       -- a different Razorpay account has not proved its webhook yet
       last_webhook_at = CASE WHEN school_razorpay_credentials.key_id = EXCLUDED.key_id THEN school_razorpay_credentials.last_webhook_at END,
       updated_at = CURRENT_TIMESTAMP`,
    [
      schoolId, id,
      secretIsNew ? encryptSecret(secret) : existing.key_secret_enc,
      maskSecret(secret),
      hookIsNew ? encryptSecret(hook) : existing.webhook_secret_enc,
      hookHint,
      mode, superAdminId,
    ]
  );

  await audit({
    schoolId, actorType: 'super_admin', actorId: superAdminId,
    action: existing ? 'razorpay.connection_updated' : 'razorpay.connected',
    entityType: 'school', entityId: schoolId,
    detail: { key_id: id, mode, key_secret_replaced: secretIsNew, webhook_secret_replaced: hookIsNew },
  });

  return getRazorpayConnection(schoolId);
}

export async function disconnectSchoolRazorpay({ schoolId: rawSchoolId, superAdminId = null }) {
  const schoolId = schoolIdOf(rawSchoolId);
  if (!schoolId) throw new RazorpayConnectionError(404, 'School not found');
  const school = await pool.query('SELECT id FROM schools WHERE id = $1', [schoolId]);
  if (school.rowCount === 0) throw new RazorpayConnectionError(404, 'School not found');
  const del = await pool.query('DELETE FROM school_razorpay_credentials WHERE school_id = $1', [schoolId]);
  if (del.rowCount > 0) {
    await audit({ schoolId, actorType: 'super_admin', actorId: superAdminId, action: 'razorpay.disconnected', entityType: 'school', entityId: schoolId });
  }
  return getRazorpayConnection(schoolId);
}

// ---------- used by the money paths ----------

// The Razorpay client for THIS school's account. Throws (statusCode 409,
// code RAZORPAY_NOT_CONNECTED) when the school has no keys — callers must
// never fall back to the platform account.
export async function schoolRazorpayClient(schoolId) {
  const r = await pool.query('SELECT key_id, key_secret_enc FROM school_razorpay_credentials WHERE school_id = $1', [schoolId]);
  if (r.rowCount === 0) {
    const err = new Error(NOT_CONNECTED_MESSAGE);
    err.statusCode = 409;
    err.code = 'RAZORPAY_NOT_CONNECTED';
    throw err;
  }
  let keySecret;
  try {
    keySecret = decryptSecret(r.rows[0].key_secret_enc);
  } catch {
    const err = new Error("This school's saved Razorpay keys can no longer be read. Ask Waynur support to add them again.");
    err.statusCode = 409;
    err.code = 'RAZORPAY_NOT_CONNECTED';
    throw err;
  }
  return razorpayClientFor({ keyId: r.rows[0].key_id, keySecret });
}

// The secret this school's Razorpay webhooks are signed with, or null.
export async function schoolWebhookSecret(schoolId) {
  const r = await pool.query('SELECT webhook_secret_enc FROM school_razorpay_credentials WHERE school_id = $1', [schoolId]);
  if (r.rowCount === 0) return null;
  try {
    return decryptSecret(r.rows[0].webhook_secret_enc);
  } catch {
    return null;
  }
}

export async function markSchoolWebhookSeen(schoolId) {
  await pool.query('UPDATE school_razorpay_credentials SET last_webhook_at = NOW() WHERE school_id = $1', [schoolId]).catch(() => {});
}

// Turns a failed Razorpay call into something a school accountant can act on.
export function razorpayFailure(err) {
  if (err?.code === 'RAZORPAY_NOT_CONNECTED') return { status: 409, message: err.message };
  const status = err?.response?.status;
  if (status === 401) {
    return { status: 502, message: "Razorpay rejected this school's keys. Ask Waynur support to check the school's Razorpay connection." };
  }
  if (status) {
    const description = err.response?.data?.error?.description;
    return { status: 502, message: description ? `Razorpay could not create the payment link: ${description}` : 'Razorpay could not create the payment link. Please try again.' };
  }
  return { status: 502, message: 'Could not reach Razorpay. Please try again in a minute.' };
}
