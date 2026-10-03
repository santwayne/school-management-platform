import axios from 'axios';
import pool from '../config/db.js';
import { decryptSecret } from '../utils/secretBox.js';

// Every school sends from ITS OWN WhatsApp Business number. The number and
// its keys (Phone Number ID + access token) are added by a Super Admin
// (routes/superAdmin.js → PUT /schools/:id/whatsapp) and stored per school;
// the access token is encrypted at rest (utils/secretBox.js).
//
// There is deliberately NO platform-wide fallback number any more: a school
// with no connection simply cannot send, and every send function throws
// WhatsAppNotConnectedError so callers log/record the reason exactly the
// way they already do for a Meta API failure.

// WHATSAPP_API_BASE: override only for local testing (mock Graph API).
const graphBase = () => process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com/v21.0';

export class WhatsAppNotConnectedError extends Error {
  constructor(schoolId) {
    super("WhatsApp is not connected for this school yet. The Waynur team connects the school's WhatsApp Business number.");
    this.name = 'WhatsAppNotConnectedError';
    this.code = 'WHATSAPP_NOT_CONNECTED';
    this.schoolId = schoolId;
  }
}

// Short cache so a 400-parent broadcast doesn't read + decrypt 400 times.
const CACHE_MS = 60 * 1000;
const cache = new Map(); // schoolId -> { at, creds }

export function clearWhatsAppCredentialCache(schoolId) {
  if (schoolId == null) cache.clear();
  else cache.delete(Number(schoolId));
}

// Returns { phoneNumberId, accessToken, wabaId, displayNumber } or null.
export async function getSchoolWhatsApp(schoolId) {
  const id = Number(schoolId);
  if (!id) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.creds;

  const r = await pool.query(
    `SELECT c.access_token_enc, c.waba_id, ss.whatsapp_phone_number_id, ss.whatsapp_business_number, ss.whatsapp_connected
     FROM school_whatsapp_credentials c
     JOIN school_settings ss ON ss.school_id = c.school_id
     WHERE c.school_id = $1`,
    [id]
  );
  const row = r.rows[0];
  let creds = null;
  if (row && row.whatsapp_connected && row.whatsapp_phone_number_id && row.access_token_enc) {
    try {
      creds = {
        phoneNumberId: row.whatsapp_phone_number_id,
        accessToken: decryptSecret(row.access_token_enc),
        wabaId: row.waba_id || null,
        displayNumber: row.whatsapp_business_number || null,
      };
    } catch (err) {
      console.error(`[WhatsApp] Stored credentials for school ${id} could not be decrypted:`, err.message);
    }
  }
  cache.set(id, { at: Date.now(), creds });
  return creds;
}

async function requireCreds(schoolId) {
  const creds = await getSchoolWhatsApp(schoolId);
  if (!creds) throw new WhatsAppNotConnectedError(schoolId);
  return creds;
}

async function postMessage(schoolId, payload) {
  const creds = await requireCreds(schoolId);
  const { data } = await axios.post(`${graphBase()}/${creds.phoneNumberId}/messages`, payload, {
    headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  return data;
}

// Asks Meta whether this Phone Number ID + token pair is real and usable.
// Used by the Super Admin screen BEFORE anything is saved, so a typo never
// leaves a school "connected" to a number that can't send.
export async function verifyWhatsAppCredentials({ phoneNumberId, accessToken }) {
  try {
    const { data } = await axios.get(`${graphBase()}/${encodeURIComponent(phoneNumberId)}`, {
      params: { fields: 'display_phone_number,verified_name,quality_rating' },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000,
    });
    return {
      ok: true,
      displayPhoneNumber: data.display_phone_number || null,
      verifiedName: data.verified_name || null,
      qualityRating: data.quality_rating || null,
    };
  } catch (err) {
    const meta = err.response?.data?.error;
    return {
      ok: false,
      error: meta?.code === 190
        ? 'Meta rejected the access token (invalid or expired). Generate a permanent System User token and try again.'
        : meta?.message || err.message,
    };
  }
}

// Sends a pre-approved Meta template message (required for the first
// outbound message in a conversation window, e.g. the absence alert).
// The template must be approved on THIS school's WhatsApp Business Account.
export async function sendTemplateMessage(schoolId, toPhone, templateName, languageCode, params = []) {
  const payload = {
    messaging_product: 'whatsapp',
    to: toPhone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: params.length
        ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }]
        : [],
    },
  };

  try {
    return await postMessage(schoolId, payload);
  } catch (err) {
    if (err.response) {
      console.error(`[WhatsApp] school ${schoolId} template "${templateName}" failed:`, err.response.status, JSON.stringify(err.response.data));
    }
    throw err;
  }
}

// Sends a free-form text reply (only valid inside an open 24h conversation
// window, e.g. replying to a doubt the parent/student just messaged in).
export async function sendTextMessage(schoolId, toPhone, body) {
  return postMessage(schoolId, {
    messaging_product: 'whatsapp',
    to: toPhone,
    type: 'text',
    text: { body },
  });
}

// Sends a document/image link with a caption — used for class notes/plans
// that have an attachment (e.g. a PDF worksheet). Only valid inside an open
// 24h conversation window, same as sendTextMessage.
export async function sendMediaMessage(schoolId, toPhone, mediaUrl, caption) {
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(mediaUrl);
  return postMessage(schoolId, {
    messaging_product: 'whatsapp',
    to: toPhone,
    type: isImage ? 'image' : 'document',
    [isImage ? 'image' : 'document']: {
      link: mediaUrl,
      caption,
      ...(isImage ? {} : { filename: mediaUrl.split('/').pop() || 'attachment' }),
    },
  });
}

// Media sent TO a school's number can only be downloaded with that school's token.
export async function downloadMedia(schoolId, mediaId) {
  const creds = await requireCreds(schoolId);
  const headers = { Authorization: `Bearer ${creds.accessToken}` };
  const metaRes = await axios.get(`${graphBase()}/${mediaId}`, { headers, timeout: 10000 });
  const fileRes = await axios.get(metaRes.data.url, { headers, responseType: 'arraybuffer', timeout: 20000 });
  return { buffer: fileRes.data, mimeType: metaRes.data.mime_type };
}
