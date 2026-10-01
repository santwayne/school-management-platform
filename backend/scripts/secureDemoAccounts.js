// One-off: lock down default/demo credentials on a production database.
//   node scripts/secureDemoAccounts.js            → dry run, lists what it would change
//   node scripts/secureDemoAccounts.js --apply    → rotates them
// Demo principal/teacher + STU001 get a random unusable password/PIN (rows are
// kept so no foreign keys break; delete them later from Super Admin if wanted).
// Any super admin still on changeme123 gets a new random password printed ONCE.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();
const apply = process.argv.includes('--apply');
const rand = (n = 18) => crypto.randomBytes(n).toString('base64url');

async function main() {
  const out = [];
  const sa = await pool.query(`SELECT id, email, password_hash FROM super_admins`);
  for (const r of sa.rows) {
    if (await bcrypt.compare('changeme123', r.password_hash)) {
      const pw = rand(12);
      if (apply) await pool.query(`UPDATE super_admins SET password_hash = $2 WHERE id = $1`, [r.id, await bcrypt.hash(pw, 10)]);
      out.push(`super admin ${r.email} → new password: ${apply ? pw : '(dry run)'}`);
    }
  }
  const t = await pool.query(`SELECT id, email, password_hash FROM teachers WHERE email IN ('principal@demoschool.test', 'teacher@demoschool.test')`);
  for (const r of t.rows) {
    if (await bcrypt.compare('changeme123', r.password_hash)) {
      if (apply) await pool.query(`UPDATE teachers SET password_hash = $2 WHERE id = $1`, [r.id, await bcrypt.hash(rand(), 10)]);
      out.push(`${r.email} → disabled (random password)`);
    }
  }
  const s = await pool.query(`SELECT id, pin_hash FROM students WHERE login_id = 'STU001'`);
  for (const r of s.rows) {
    if (r.pin_hash && await bcrypt.compare('1234', r.pin_hash)) {
      if (apply) await pool.query(`UPDATE students SET pin_hash = $2 WHERE id = $1`, [r.id, await bcrypt.hash(rand(), 10)]);
      out.push('student STU001 → disabled (random PIN)');
    }
  }
  console.log(out.length ? out.join('\n') : 'No default credentials found.');
  if (!apply && out.length) console.log('\nDry run. Re-run with --apply to change them.');
  if (apply) console.log('\nAlso set SEED_DEMO_DATA unset/false in production .env so they are not recreated.');
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
