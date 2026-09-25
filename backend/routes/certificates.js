import express from 'express';
import rateLimit from 'express-rate-limit';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { registerAction, audit } from '../services/opsService.js';
import { approveCertificate, certificatePdf, processPendingRequests } from '../services/certificateService.js';

export const router = express.Router();
export const publicRouter = express.Router();

const isStaff = (u) => ['principal', 'operator', 'accountant'].includes(u?.role);
registerAction('certificate.approve', ({ params, user }) => approveCertificate(user.school_id, params.request_id, user));

router.use(requireAuth);

router.get('/', async (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: 'Not allowed' });
  const r = await pool.query(
    `SELECT ic.id, ic.cert_type, ic.serial, ic.verify_code, ic.issued_at, ic.revoked_at, ic.issued_by IS NULL AS automatic, s.name AS student_name
     FROM issued_certificates ic JOIN students s ON s.id = ic.student_id WHERE ic.school_id = $1 ORDER BY ic.id DESC LIMIT 300`,
    [req.user.school_id]
  );
  res.json(r.rows);
});

// Staff, or the student the certificate belongs to (student portal).
router.get('/:id/pdf', async (req, res) => {
  try {
    const pdf = await certificatePdf(Number(req.params.id), req.user.school_id);
    if (!pdf) return res.status(404).json({ error: 'Not found' });
    const own = req.user.role === 'student' && req.user.student_id === pdf.studentId;
    if (!isStaff(req.user) && !own) return res.status(403).json({ error: 'Not allowed' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
    res.send(pdf.buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/requests/:id/approve', async (req, res) => {
  try {
    res.json(await approveCertificate(req.user.school_id, Number(req.params.id), req.user));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/revoke', async (req, res) => {
  if (req.user.role !== 'principal') return res.status(403).json({ error: 'Only the principal can revoke a certificate' });
  const r = await pool.query(`UPDATE issued_certificates SET revoked_at = NOW() WHERE id = $1 AND school_id = $2 AND revoked_at IS NULL RETURNING id, serial`, [req.params.id, req.user.school_id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Not found or already revoked' });
  await audit({ schoolId: req.user.school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'certificate.revoked', entityType: 'certificate', entityId: r.rows[0].id, detail: { serial: r.rows[0].serial, reason: req.body?.reason || null } });
  res.json({ ok: true });
});

router.post('/process', async (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: 'Not allowed' });
  res.json(await processPendingRequests(req.user.school_id));
});

// Anyone (e.g. another school receiving a TC) can check a certificate is real.
// Shows only what is printed on the certificate itself.
const verifyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
publicRouter.get('/verify/:code', verifyLimiter, async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(code)) return res.status(400).json({ valid: false, error: 'Invalid code' });
  const r = await pool.query(`SELECT cert_type, serial, data, issued_at, revoked_at FROM issued_certificates WHERE verify_code = $1`, [code]);
  const c = r.rows[0];
  if (!c) return res.status(404).json({ valid: false, error: 'No certificate with this code' });
  res.json({
    valid: !c.revoked_at,
    revoked: !!c.revoked_at,
    title: c.data.title,
    serial: c.serial,
    school: c.data.school?.name,
    student_name: c.data.student?.name,
    class: c.data.student?.class,
    issued_on: c.data.issued_on,
  });
});

export default router;
