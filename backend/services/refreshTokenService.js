import crypto from 'crypto';
import pool from '../config/db.js';

const REFRESH_TOKEN_TTL_DAYS = 30;

export function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function newExpiry() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export async function issueRefreshToken({ subjectType, subjectId, schoolId }) {
  const raw = crypto.randomBytes(40).toString('hex');
  await pool.query(
    `INSERT INTO refresh_tokens (subject_type, subject_id, school_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [subjectType, subjectId, schoolId || null, hashToken(raw), newExpiry()]
  );
  return raw;
}

// Validates a raw refresh token and rotates it: the used row is deleted and
// a new one is issued for the same subject, both inside one transaction, so
// the token can only ever be redeemed once. Returns null for anything
// invalid, expired, or already used, rather than throwing — the caller
// treats that as "please log in again", not a server error.
export async function rotateRefreshToken(rawToken) {
  const hash = hashToken(rawToken);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `DELETE FROM refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
       RETURNING subject_type, subject_id, school_id`,
      [hash]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const { subject_type: subjectType, subject_id: subjectId, school_id: schoolId } = rows[0];
    const newRaw = crypto.randomBytes(40).toString('hex');
    await client.query(
      `INSERT INTO refresh_tokens (subject_type, subject_id, school_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [subjectType, subjectId, schoolId, hashToken(newRaw), newExpiry()]
    );
    await client.query('COMMIT');
    return { subjectType, subjectId, schoolId, refreshToken: newRaw };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeRefreshToken(rawToken) {
  await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hashToken(rawToken)]);
}

// Used when an account's access should be cut immediately (e.g. a future
// "deactivate staff" action) rather than waiting for its refresh token to
// expire on its own.
export async function revokeAllRefreshTokensForSubject(subjectType, subjectId) {
  await pool.query('DELETE FROM refresh_tokens WHERE subject_type = $1 AND subject_id = $2', [subjectType, subjectId]);
}
