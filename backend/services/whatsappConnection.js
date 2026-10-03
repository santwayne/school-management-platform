import pool from '../config/db.js';
import { encryptSecret, decryptSecret, maskSecret } from '../utils/secretBox.js';
import { verifyWhatsAppCredentials, clearWhatsAppCredentialCache } from './whatsappService.js';
import { sendEmail, whatsappConnectedEmail } from './emailService.js';
import { audit } from './opsService.js';

// Everything a Super Admin does to a school's WhatsApp connection goes
// through here (routes/superAdmin.js), so "add the keys at school creation"
// and "add/replace them later" behave identically: verify with Meta → save
// (token encrypted) → email the principal.

export class ConnectionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Meta ids are long numeric strings.
const isMetaId = (v) => /^\d{5,30}$/.test(String(v || ''));

function normalizeBusinessNumber(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  // A bare 10-digit number is an Indian mobile; anything longer already carries its country code.
  return `+${digits.length === 10 ? `91${digits}` : digits}`;
}

async function principalsOf(schoolId) {
  const r = await pool.query(
    `SELECT name, email FROM teachers
     WHERE school_id = $1 AND role = 'principal' AND COALESCE(is_demo, FALSE) = FALSE AND email IS NOT NULL AND email <> ''
     ORDER BY id`,
    [schoolId]
  );
  return r.rows;
}

// What the Super Admin screen shows. Never includes the token itself.
export async function getWhatsAppConnection(schoolId) {
  const r = await pool.query(
    `SELECT s.id AS school_id, s.name AS school_name,
            COALESCE(ss.whatsapp_connected, FALSE) AS connected,
            ss.whatsapp_business_number AS whatsapp_number,
            ss.whatsapp_phone_number_id AS phone_number_id,
            ss.whatsapp_verified_name AS verified_name,
            ss.whatsapp_connected_at AS connected_at,
            ss.whatsapp_connection_emailed_at AS emailed_at,
            c.waba_id, c.token_hint, c.updated_at AS keys_updated_at
     FROM schools s
     LEFT JOIN school_settings ss ON ss.school_id = s.id
     LEFT JOIN school_whatsapp_credentials c ON c.school_id = s.id
     WHERE s.id = $1`,
    [schoolId]
  );
  if (r.rowCount === 0) throw new ConnectionError(404, 'School not found');
  const principals = await principalsOf(schoolId);
  return { ...r.rows[0], has_token: Boolean(r.rows[0].token_hint), principal_emails: principals.map((p) => p.email) };
}

export async function emailPrincipalWhatsAppConnected(schoolId) {
  const conn = await getWhatsAppConnection(schoolId);
  if (!conn.connected) return { sent: false, reason: 'WhatsApp is not connected for this school.' };
  const principals = await principalsOf(schoolId);
  if (principals.length === 0) return { sent: false, reason: 'No principal email address on file for this school.' };

  const mail = whatsappConnectedEmail({
    principalName: principals.length === 1 ? principals[0].name : null,
    schoolName: conn.school_name,
    number: conn.whatsapp_number,
    verifiedName: conn.verified_name,
    connectedAt: conn.connected_at || new Date(),
  });
  const result = await sendEmail({ to: principals.map((p) => p.email), ...mail });
  if (result.sent) {
    await pool.query('UPDATE school_settings SET whatsapp_connection_emailed_at = NOW() WHERE school_id = $1', [schoolId]);
  }
  return result;
}

/**
 * Save (or replace) a school's WhatsApp number + keys.
 * access_token may be omitted when keys already exist — e.g. correcting the
 * display number — in which case the stored token is kept.
 */
export async function connectSchoolWhatsApp({ schoolId, whatsappNumber, phoneNumberId, accessToken, wabaId, superAdminId = null, notify = true }) {
  const school = await pool.query('SELECT id, name FROM schools WHERE id = $1', [schoolId]);
  if (school.rowCount === 0) throw new ConnectionError(404, 'School not found');

  const number = normalizeBusinessNumber(whatsappNumber);
  if (!number) throw new ConnectionError(400, 'whatsapp_number must be the full WhatsApp Business number with country code, e.g. +91 98765 43210');
  const phoneId = String(phoneNumberId || '').trim();
  if (!isMetaId(phoneId)) throw new ConnectionError(400, 'phone_number_id must be the numeric Phone Number ID from Meta (WhatsApp > API Setup)');
  const waba = String(wabaId || '').trim() || null;
  if (waba && !isMetaId(waba)) throw new ConnectionError(400, 'waba_id must be the numeric WhatsApp Business Account ID from Meta');

  let token = String(accessToken || '').trim();
  let tokenEnc = null;
  if (token) {
    tokenEnc = encryptSecret(token);
  } else {
    const existing = await pool.query('SELECT access_token_enc FROM school_whatsapp_credentials WHERE school_id = $1', [schoolId]);
    if (existing.rowCount === 0) throw new ConnectionError(400, 'access_token is required');
    try {
      token = decryptSecret(existing.rows[0].access_token_enc);
    } catch {
      throw new ConnectionError(400, 'The saved access token can no longer be read — please paste the token again.');
    }
  }

  const taken = await pool.query('SELECT school_id FROM school_settings WHERE whatsapp_phone_number_id = $1 AND school_id <> $2', [phoneId, schoolId]);
  if (taken.rowCount > 0) throw new ConnectionError(409, 'This Phone Number ID is already connected to another school.');

  // Prove the keys work before anything is saved.
  const check = await verifyWhatsAppCredentials({ phoneNumberId: phoneId, accessToken: token });
  if (!check.ok) throw new ConnectionError(400, `Meta did not accept these keys: ${check.error}`);

  // The number typed must be the number those keys actually belong to.
  const metaDigits = String(check.displayPhoneNumber || '').replace(/\D/g, '');
  if (metaDigits && metaDigits !== number.replace(/\D/g, '')) {
    throw new ConnectionError(400, `These keys belong to ${check.displayPhoneNumber}, not ${number}. Check the number or the Phone Number ID.`);
  }

  const client = await pool.connect();
  let wasConnected = false;
  let previousNumber = null;
  try {
    await client.query('BEGIN');
    const before = await client.query('SELECT whatsapp_connected, whatsapp_business_number FROM school_settings WHERE school_id = $1 FOR UPDATE', [schoolId]);
    wasConnected = Boolean(before.rows[0]?.whatsapp_connected);
    previousNumber = before.rows[0]?.whatsapp_business_number || null;

    await client.query(
      `INSERT INTO school_settings (school_id, whatsapp_business_number, whatsapp_phone_number_id, whatsapp_verified_name, whatsapp_connected, whatsapp_connected_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())
       ON CONFLICT (school_id) DO UPDATE SET
         whatsapp_business_number = EXCLUDED.whatsapp_business_number,
         whatsapp_phone_number_id = EXCLUDED.whatsapp_phone_number_id,
         whatsapp_verified_name = EXCLUDED.whatsapp_verified_name,
         whatsapp_connected = TRUE,
         whatsapp_connected_at = CASE WHEN school_settings.whatsapp_connected AND school_settings.whatsapp_business_number = EXCLUDED.whatsapp_business_number
                                      THEN COALESCE(school_settings.whatsapp_connected_at, NOW()) ELSE NOW() END,
         whatsapp_pending_number = NULL, whatsapp_verify_code = NULL, whatsapp_verify_expires_at = NULL,
         updated_at = CURRENT_TIMESTAMP`,
      [schoolId, number, phoneId, check.verifiedName]
    );
    if (tokenEnc) {
      await client.query(
        `INSERT INTO school_whatsapp_credentials (school_id, access_token_enc, token_hint, waba_id, connected_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (school_id) DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc, token_hint = EXCLUDED.token_hint,
           waba_id = EXCLUDED.waba_id, connected_by = EXCLUDED.connected_by, updated_at = CURRENT_TIMESTAMP`,
        [schoolId, tokenEnc, maskSecret(token), waba, superAdminId]
      );
    } else {
      await client.query('UPDATE school_whatsapp_credentials SET waba_id = $2, connected_by = $3, updated_at = CURRENT_TIMESTAMP WHERE school_id = $1', [schoolId, waba, superAdminId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') throw new ConnectionError(409, 'This Phone Number ID is already connected to another school.');
    throw err;
  } finally {
    client.release();
  }
  clearWhatsAppCredentialCache(schoolId);

  const numberChanged = !wasConnected || previousNumber !== number;
  await audit({
    schoolId, actorType: 'super_admin', actorId: superAdminId,
    action: wasConnected ? 'whatsapp.connection_updated' : 'whatsapp.connected',
    entityType: 'school', entityId: schoolId,
    detail: { number, phone_number_id: phoneId, token_replaced: Boolean(tokenEnc) },
  });

  // Only email when the principal has something new to know: a first
  // connection or a different number — not a silent token rotation.
  let email = { sent: false, reason: numberChanged ? 'Notification was switched off for this save.' : 'Number unchanged — principal was not emailed again.' };
  if (notify && numberChanged) email = await emailPrincipalWhatsAppConnected(schoolId);

  return { connection: await getWhatsAppConnection(schoolId), email, quality_rating: check.qualityRating };
}

export async function disconnectSchoolWhatsApp({ schoolId, superAdminId = null }) {
  const school = await pool.query('SELECT id FROM schools WHERE id = $1', [schoolId]);
  if (school.rowCount === 0) throw new ConnectionError(404, 'School not found');
  await pool.query('DELETE FROM school_whatsapp_credentials WHERE school_id = $1', [schoolId]);
  await pool.query(
    `UPDATE school_settings SET whatsapp_connected = FALSE, whatsapp_phone_number_id = NULL, whatsapp_connected_at = NULL,
            whatsapp_connection_emailed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE school_id = $1`,
    [schoolId]
  );
  clearWhatsAppCredentialCache(schoolId);
  await audit({ schoolId, actorType: 'super_admin', actorId: superAdminId, action: 'whatsapp.disconnected', entityType: 'school', entityId: schoolId });
  return getWhatsAppConnection(schoolId);
}
