import crypto from 'crypto';
import path from 'path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3, s3PublicUrl } from '../utils/s3.js';

// Images and documents a teacher can attach to homework / lesson plans.
// No SVG/HTML: they can carry script and would be served from our bucket.
export const TEACHING_MEDIA_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};
export const TEACHING_MEDIA_MAX_BYTES = 15 * 1024 * 1024;

export class MediaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Stores one file under teaching/<school>/ and returns the public URL plus a
// clean display name. WhatsApp media links must be publicly fetchable, hence
// the public-read bucket path (same as the logo and blog uploads).
export async function storeTeachingMedia({ schoolId, buffer, mimeType, originalName }) {
  const ext = TEACHING_MEDIA_TYPES[mimeType];
  if (!ext) throw new MediaError(400, 'Attach a JPG, PNG, WebP, PDF, Word, PowerPoint or Excel file.');
  if (buffer.length > TEACHING_MEDIA_MAX_BYTES) throw new MediaError(413, 'File must be under 15 MB.');
  if (!process.env.AWS_S3_BUCKET) throw new MediaError(503, 'File storage is not configured (AWS_S3_BUCKET missing on the server).');

  const base =
    path.basename(originalName || 'attachment', path.extname(originalName || ''))
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'attachment';
  const key = `teaching/${schoolId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${base}${ext}`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return { url: s3PublicUrl(key), name: `${base}${ext}`, mimeType };
}

// Only accept attachment URLs that point at our own bucket, so a teacher can't
// make the school's WhatsApp number send an arbitrary external link.
export function isOwnMediaUrl(url, schoolId) {
  if (!url) return true;
  if (!process.env.AWS_S3_BUCKET) return false;
  return String(url).startsWith(s3PublicUrl(`teaching/${schoolId}/`));
}
