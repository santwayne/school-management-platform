import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { isReadOnly } from '../services/billingMath.js';
import { isPlanReadOnly, hasAi } from '../services/planMath.js';

// AI features that only schools on the Waynur AI plan (or its demo) get.
// The tutor is blocked entirely; the others only for actions (non-GET), so a
// Core school can still open anything it made earlier.
const AI_ONLY_ALL_METHODS = [/^\/api\/tutor(\/|$)/];
const AI_ONLY_WRITES = [/^\/api\/assistant(\/|$)/, /^\/api\/premium-ai(\/|$)/, /^\/api\/grading(\/|$)/];

// Writes still allowed while a school is billing-restricted: paying (billing),
// staying logged in (auth), and the student portal's own session actions.
const READ_ONLY_WRITE_ALLOWLIST = [/^\/api\/billing(\/|$)/, /^\/api\/auth(\/|$)/];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Verifies the JWT and attaches { teacher_id, school_id, role } to req.user.
// Every route that touches school data should sit behind this — it is what
// makes school_id trustworthy instead of taking it from the request body.
//
// Also blocks access if the token's school has been suspended by a super
// admin (super-admin tokens carry no school_id, so they skip this check).
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization bearer token' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = payload; // { teacher_id / student_id / super_admin_id, school_id, role }

  try {
    if (req.user.school_id) {
      const schoolRes = await pool.query(
        `SELECT status, billing_status, billing_grace_until, current_period_end,
                plan, plan_state, demo_ends_at, paid_until
           FROM schools WHERE id = $1`,
        [req.user.school_id]
      );
      if (schoolRes.rowCount === 0 || schoolRes.rows[0].status === 'suspended') {
        return res.status(403).json({ error: 'This school is currently suspended.' });
      }
      // Halted past grace / cancelled past period end → read-only. Every
      // GET keeps working (no data is ever hidden); only writes are refused.
      const school = schoolRes.rows[0];
      const planReadOnly = isPlanReadOnly(school);
      req.billingReadOnly = isReadOnly(school) || planReadOnly;
      const path = req.originalUrl.split('?')[0];
      if (req.billingReadOnly && !SAFE_METHODS.has(req.method) && !READ_ONLY_WRITE_ALLOWLIST.some((re) => re.test(path))) {
        return res.status(402).json({
          error: planReadOnly
            ? 'Your Waynur demo or plan period has ended, so the account is read-only (all your data is safe). Contact Waynur to continue.'
            : 'Your Waynur subscription is inactive, so the account is read-only. The principal can renew from Billing to resume editing.',
          code: planReadOnly ? 'PLAN_EXPIRED' : 'BILLING_READ_ONLY',
        });
      }
      // Core plan: AI features are off.
      req.planHasAi = hasAi(school);
      const aiOnly = AI_ONLY_ALL_METHODS.some((re) => re.test(path))
        || (!SAFE_METHODS.has(req.method) && AI_ONLY_WRITES.some((re) => re.test(path)));
      if (aiOnly && !req.planHasAi) {
        return res.status(403).json({
          error: 'This is a Waynur AI plan feature. Your school is on Waynur Core — contact Waynur to upgrade.',
          code: 'PLAN_NO_AI',
        });
      }
    }
    next();
  } catch (err) {
    console.error('requireAuth school-status check failed:', err.message);
    return res.status(500).json({ error: 'Internal server error while verifying access' });
  }
}

// Restricts a route to principals only (e.g. petty-cash approval, analytics).
export function requirePrincipal(req, res, next) {
  if (!req.user || req.user.role !== 'principal') {
    return res.status(403).json({ error: 'Principal role required' });
  }
  next();
}

// Restricts a route to the student portal (e.g. AI tutor chat) — keeps
// student tokens out of teacher/principal-only endpoints and vice versa.
export function requireStudent(req, res, next) {
  if (!req.user || req.user.role !== 'student') {
    return res.status(403).json({ error: 'Student login required' });
  }
  next();
}

// Who may change the school's Waynur plan: the Principal (the school's
// owner account). Accountants can VIEW billing but never change it.
export function requireBillingOwner(req, res, next) {
  if (!req.user || req.user.role !== 'principal') {
    return res.status(403).json({ error: 'Only the Principal can change the Waynur plan' });
  }
  next();
}

// Restricts a route to the super admin (multi-school management) panel.
export function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin role required' });
  }
  next();
}

// Restricts a route to accountants (e.g. petty cash, payroll, fee collection).
export function requireAccountant(req, res, next) {
  if (!req.user || req.user.role !== 'accountant') {
    return res.status(403).json({ error: 'Accountant role required' });
  }
  next();
}

// Restricts a route to principal OR accountant — most finance routes should
// use this instead of requirePrincipal alone, now that Accountant exists.
export function requireFinance(req, res, next) {
  if (!req.user || (req.user.role !== 'principal' && req.user.role !== 'accountant')) {
    return res.status(403).json({ error: 'Principal or Accountant role required' });
  }
  next();
}

// Restricts a route to principal OR librarian — same shape as requireFinance,
// used by the library routes (routes/library.js) now that a dedicated
// Librarian role exists instead of every catalog/issue/return action needing
// the Principal's own credentials.
export function requireLibrary(req, res, next) {
  if (!req.user || (req.user.role !== 'principal' && req.user.role !== 'librarian')) {
    return res.status(403).json({ error: 'Principal or Librarian role required' });
  }
  next();
}

// Operator Control Center: the school's single software operator, plus the
// principal (who can always see what the operator sees).
export function requireOperator(req, res, next) {
  if (!req.user || (req.user.role !== 'principal' && req.user.role !== 'operator')) {
    return res.status(403).json({ error: 'Operator or Principal role required' });
  }
  next();
}
