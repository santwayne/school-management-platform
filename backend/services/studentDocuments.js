import crypto from 'crypto';
import path from 'path';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import pool from '../config/db.js';
import { s3 } from '../utils/s3.js';

// Supporting documents on a student's profile: photos, certificates, ID
// proofs, etc. Unlike profile photos these are NOT linked by public URL — the
// file is kept under a private key and streamed through an authenticated
// endpoint, because ID documents and certificates are sensitive.

export const DOC_TYPES = {
  photo: 'Photo',
  birth_certificate: 'Birth certificate',
  id_proof: 'ID proof (Aadhaar / passport)',
  transfer_certificate: 'Transfer certificate',
  marksheet: 'Previous marksheet',
  medical: 'Medical record',
  address_proof: 'Address proof',
  other: 'Other',
};

export const DOC_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};
export const DOC_MAX_BYTES = 8 * 1024 * 1024;

export class DocumentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const cols = 'id, doc_type, title, file_name, mime_type, size_bytes, created_at';

export async function listStudentDocuments(schoolId, studentId) {
  const { rows } = await pool.query(
    `SELECT ${cols} FROM student_documents WHERE school_id = $1 AND student_id = $2 ORDER BY created_at DESC`,
    [schoolId, studentId]
  );
  return rows;
}

export async function addStudentDocument({ schoolId, studentId, uploadedBy, docType, title, file }) {
  if (!DOC_TYPES[docType]) throw new DocumentError(400, 'Choose what kind of document this is.');
  if (!DOC_MIME[file.mimetype]) throw new DocumentError(400, 'Upload a JPG, PNG, WebP or PDF file.');
  if (file.size > DOC_MAX_BYTES) throw new DocumentError(413, 'File must be under 8 MB.');
  if (!process.env.AWS_S3_BUCKET) throw new DocumentError(503, 'File storage is not configured (AWS_S3_BUCKET missing on the server).');

  const base =
    path.basename(file.originalname || 'document', path.extname(file.originalname || ''))
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'document';
  const key = `waynur/student-docs/${schoolId}/${studentId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${base}${DOC_MIME[file.mimetype]}`;
  await s3.send(new PutObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key, Body: file.buffer, ContentType: file.mimetype }));

  const { rows } = await pool.query(
    `INSERT INTO student_documents (school_id, student_id, doc_type, title, file_key, file_name, mime_type, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${cols}`,
    [schoolId, studentId, docType, String(title || DOC_TYPES[docType]).trim().slice(0, 255), key, `${base}${DOC_MIME[file.mimetype]}`, file.mimetype, file.size, uploadedBy || null]
  );
  return rows[0];
}

// Streams a stored document to the response (caller has already authorised).
export async function streamStudentDocument(schoolId, studentId, docId, res) {
  const { rows } = await pool.query(
    'SELECT file_key, file_name, mime_type FROM student_documents WHERE id = $1 AND school_id = $2 AND student_id = $3',
    [Number(docId) || 0, schoolId, studentId]
  );
  if (!rows.length) throw new DocumentError(404, 'Document not found');
  const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: rows[0].file_key }));
  res.setHeader('Content-Type', rows[0].mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${rows[0].file_name}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  obj.Body.pipe(res);
}

export async function deleteStudentDocument(schoolId, studentId, docId) {
  const { rows } = await pool.query(
    'DELETE FROM student_documents WHERE id = $1 AND school_id = $2 AND student_id = $3 RETURNING file_key',
    [Number(docId) || 0, schoolId, studentId]
  );
  if (!rows.length) throw new DocumentError(404, 'Document not found');
  // Best effort: the row is gone, so a failed object delete only leaves an orphan.
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: rows[0].file_key })).catch((e) => console.error('Student document S3 delete failed:', e.message));
}
