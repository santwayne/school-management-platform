import axios from 'axios';
import crypto from 'crypto';

// Plain REST (no SDK) — same pattern as before. Needs RAZORPAY_KEY_ID /
// RAZORPAY_KEY_SECRET; fails loudly at request time without them.
export function razorpayClient() {
  return axios.create({
    baseURL: process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com/v1', // override only for local testing
    auth: { username: process.env.RAZORPAY_KEY_ID, password: process.env.RAZORPAY_KEY_SECRET },
    timeout: 10000,
  });
}

// Constant-time HMAC check of the exact raw bytes Razorpay sent.
export function verifyWebhookSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Checkout success callback signatures (client → server confirmation; the
// webhook is still the source of truth, this only drives the UI faster).
export function verifyCheckoutSignature({ orderId, subscriptionId, paymentId, signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !paymentId || !signature) return false;
  const body = subscriptionId ? `${paymentId}|${subscriptionId}` : `${orderId}|${paymentId}`;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
