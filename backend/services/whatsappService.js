import axios from 'axios';

const GRAPH_URL = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

function client() {
  return axios.create({
    baseURL: GRAPH_URL,
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });
}

// Sends a pre-approved Meta template message (required for the first
// outbound message in a conversation window, e.g. the absence alert).
export async function sendTemplateMessage(toPhone, templateName, languageCode, params = []) {
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

  const { data } = await client().post('', payload);
  return data;
}

// Sends a free-form text reply (only valid inside an open 24h conversation
// window, e.g. replying to a doubt the parent/student just messaged in).
export async function sendTextMessage(toPhone, body) {
  const payload = {
    messaging_product: 'whatsapp',
    to: toPhone,
    type: 'text',
    text: { body },
  };

  const { data } = await client().post('', payload);
  return data;
}

// Sends a document/image link with a caption — used for class notes/plans
// that have an attachment (e.g. a PDF worksheet). Only valid inside an open
// 24h conversation window, same as sendTextMessage.
export async function sendMediaMessage(toPhone, mediaUrl, caption) {
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(mediaUrl);
  const payload = {
    messaging_product: 'whatsapp',
    to: toPhone,
    type: isImage ? 'image' : 'document',
    [isImage ? 'image' : 'document']: {
      link: mediaUrl,
      caption,
      ...(isImage ? {} : { filename: mediaUrl.split('/').pop() || 'attachment' }),
    },
  };

  const { data } = await client().post('', payload);
  return data;
}

export async function downloadMedia(mediaId) {
  const metaRes = await axios.get(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  });
  const fileRes = await axios.get(metaRes.data.url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    responseType: 'arraybuffer',
  });
  return { buffer: fileRes.data, mimeType: metaRes.data.mime_type };
}
