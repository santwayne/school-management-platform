import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import pool from '../config/db.js';
import { requireAuth, requirePrincipal } from '../middleware/auth.js';
import { audit } from '../services/opsService.js';
import { s3, s3PublicUrl } from '../utils/s3.js';
import { normalizeBrandColor, getSchoolBranding, clearBrandingCache } from '../services/schoolBranding.js';


const router = express.Router();


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // PNG / JPG only: the logo is printed on certificates and payslips, and
    // a PDF cannot hold an SVG, WebP or GIF.
    if (!['image/png', 'image/jpeg'].includes(file.mimetype)) return cb(new Error('Please upload the logo as a PNG or JPG image'));
    cb(null, true);
  },
});

// Get this school's settings — creates a default row on first read so the
// frontend never has to handle a missing-settings case.
router.get('/', requireAuth, async (req, res) => {
  const school_id = req.user.school_id;
  try {
    let result = await pool.query('SELECT * FROM school_settings WHERE school_id = $1', [school_id]);
    if (result.rowCount === 0) {
      result = await pool.query(
        'INSERT INTO school_settings (school_id) VALUES ($1) RETURNING *',
        [school_id]
      );
    }
    const schoolRes = await pool.query('SELECT name FROM schools WHERE id = $1', [school_id]);
    // Leftovers of the removed OTP flow are never sent to the browser.
    const { whatsapp_verify_code, whatsapp_verify_expires_at, whatsapp_pending_number, ...settings } = result.rows[0];
    res.json({ ...settings, school_name: schoolRes.rows[0]?.name || null });
  } catch (err) {
    console.error('Settings fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// What the school's own documents need to look like the school's: the theme
// colour and the logo as a data URL (read server-side from our bucket, so
// the browser can put it into a PDF without any cross-origin trouble).
// Any signed-in user of the school may read it — a student downloading
// their own leaving certificate needs it too.
router.get('/branding', requireAuth, async (req, res) => {
  try {
    const brand = await getSchoolBranding(req.user.school_id);
    res.json({
      brand_color: brand.hasColor ? brand.color : null,
      logo_data_url: brand.logo ? `data:image/${brand.logoKind};base64,${brand.logo.toString('base64')}` : null,
    });
  } catch (err) {
    console.error('Branding fetch error:', err);
    res.status(500).json({ error: 'Failed to load branding' });
  }
});

// Update branding: school name, logo URL (set by POST /logo below) and the
// theme colour used on certificates and payslips. A field that is left out
// keeps its saved value; brand_color: '' (or null) clears the colour.
router.patch('/branding', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { logo_url, school_name, brand_color } = req.body;
  try {
    let color; // undefined = leave as it is
    if (brand_color !== undefined) {
      if (brand_color === null || String(brand_color).trim() === '') {
        color = null;
      } else {
        color = normalizeBrandColor(brand_color);
        if (!color) return res.status(400).json({ error: 'Theme colour must be a hex colour like #1F4E79' });
      }
    }
    if (school_name) {
      await pool.query('UPDATE schools SET name = $1 WHERE id = $2', [school_name, school_id]);
    }
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, logo_url, brand_color) VALUES ($1, $2, $3)
       ON CONFLICT (school_id) DO UPDATE SET
         logo_url = CASE WHEN $4 THEN EXCLUDED.logo_url ELSE school_settings.logo_url END,
         brand_color = CASE WHEN $5 THEN EXCLUDED.brand_color ELSE school_settings.brand_color END,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, logo_url || null, color ?? null, logo_url !== undefined, color !== undefined]
    );
    clearBrandingCache();
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Branding update error:', err);
    res.status(500).json({ error: 'Failed to update branding' });
  }
});

// WhatsApp: read-only for the school. The number and its keys are added by
// the Waynur team (Super Admin → routes/superAdmin.js PUT /schools/:id/whatsapp),
// and the principal is emailed when the number goes live. The old
// "type a number + OTP" flow was removed along with the shared platform
// number it verified against — GET / above returns the status to display.

// Update notification toggles. The frontend flips one toggle at a time
// (AdminSettings.jsx's toggleNotif sends only { [key]: value }), so the
// other four fields arrive as `undefined` here, not omitted-and-defaulted —
// QA fix (P-16): unlike the leaving-cert route below (which already does
// `?? null` for this exact reason), this route passed those raw
// `undefined`s straight into the query's params array. node-postgres has
// no defined behavior for an undefined bind parameter and throws, which
// this try/catch turned into a 500 with no useful detail — every
// single-toggle PATCH here was one bad param away from failing depending
// on which four fields happened to be present.
router.patch('/notifications', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { notify_attendance, notify_homework, notify_fees, notify_payroll, notify_weekly_summary } = req.body;
  try {
    // COALESCE(..., TRUE) in the VALUES list matters too, not just the
    // UPDATE SET clause below: these columns are NOT NULL DEFAULT TRUE, so
    // on a school's very first settings write (no row to conflict with
    // yet), a bare $n placeholder would try to INSERT an actual NULL and
    // fail the NOT NULL constraint before ON CONFLICT ever gets a chance
    // to run — same 500 the fix above was supposed to prevent, just from
    // the DB layer instead of the driver layer.
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, notify_attendance, notify_homework, notify_fees, notify_payroll, notify_weekly_summary)
       VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), COALESCE($4, TRUE), COALESCE($5, TRUE), COALESCE($6, TRUE))
       ON CONFLICT (school_id) DO UPDATE SET
         notify_attendance = COALESCE(EXCLUDED.notify_attendance, school_settings.notify_attendance),
         notify_homework = COALESCE(EXCLUDED.notify_homework, school_settings.notify_homework),
         notify_fees = COALESCE(EXCLUDED.notify_fees, school_settings.notify_fees),
         notify_payroll = COALESCE(EXCLUDED.notify_payroll, school_settings.notify_payroll),
         notify_weekly_summary = COALESCE(EXCLUDED.notify_weekly_summary, school_settings.notify_weekly_summary),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, notify_attendance ?? null, notify_homework ?? null, notify_fees ?? null, notify_payroll ?? null, notify_weekly_summary ?? null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Notification settings update error:', err);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

// QA fix (P-10): the onboarding wizard's own copy promises "you can change
// it any time" for the attendance method choice — this is that "any time".
router.patch('/attendance-method', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { attendance_method } = req.body;
  if (!['biometric', 'manual'].includes(attendance_method)) {
    return res.status(400).json({ error: 'attendance_method must be "biometric" or "manual"' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, attendance_method)
       VALUES ($1, $2)
       ON CONFLICT (school_id) DO UPDATE SET
         attendance_method = EXCLUDED.attendance_method,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, attendance_method]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Attendance method update error:', err);
    res.status(500).json({ error: 'Failed to update attendance method' });
  }
});

// Update the accountant petty-cash approval limit — requests at/under this
// amount can be approved by an accountant; above it, they need the principal.
router.patch('/petty-cash-limit', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { limit } = req.body;
  if (limit === undefined || isNaN(limit) || limit < 0) {
    return res.status(400).json({ error: 'A valid non-negative limit is required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, petty_cash_accountant_limit)
       VALUES ($1, $2)
       ON CONFLICT (school_id) DO UPDATE SET
         petty_cash_accountant_limit = EXCLUDED.petty_cash_accountant_limit,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, limit]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Petty cash limit update error:', err);
    res.status(500).json({ error: 'Failed to update petty cash limit' });
  }
});

// Statutory payroll deductions (PF/ESI) — off by default, see the schema.sql
// comment next to these columns for why and for the exact formulas applied
// in services/payrollService.js's computePay(). Audited: this silently
// changes every future payroll run's net-pay numbers.
router.patch('/payroll-deductions', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { pf_enabled, esi_enabled } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, pf_enabled, esi_enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (school_id) DO UPDATE SET
         pf_enabled = EXCLUDED.pf_enabled,
         esi_enabled = EXCLUDED.esi_enabled,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, !!pf_enabled, !!esi_enabled]
    );
    await audit({ schoolId: school_id, actorType: 'user', actorId: req.user.teacher_id, action: 'settings.payroll_deductions_updated', detail: { pf_enabled: !!pf_enabled, esi_enabled: !!esi_enabled } });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Payroll deductions update error:', err);
    res.status(500).json({ error: 'Failed to update payroll deduction settings' });
  }
});

// Item 18: how close (in meters) a bus needs to get to a student's saved
// home location before services/busProximityService.js fires a WhatsApp
// alert — same config pattern as petty-cash-limit above.
router.patch('/proximity-alert-radius', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { radius_meters } = req.body;
  if (radius_meters === undefined || isNaN(radius_meters) || radius_meters <= 0) {
    return res.status(400).json({ error: 'A valid positive radius (in meters) is required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, proximity_alert_radius_meters)
       VALUES ($1, $2)
       ON CONFLICT (school_id) DO UPDATE SET
         proximity_alert_radius_meters = EXCLUDED.proximity_alert_radius_meters,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, radius_meters]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Proximity alert radius update error:', err);
    res.status(500).json({ error: 'Failed to update proximity alert radius' });
  }
});

// Automated fee-reminder timing (workers/feeReminderWorker.js) — how many
// days of grace a newly-enrolled student gets before reminders start, and
// how many days apart repeat reminders are spaced.
router.patch('/fee-reminder-timing', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { grace_days, interval_days } = req.body;
  if (grace_days === undefined || isNaN(grace_days) || grace_days < 0) {
    return res.status(400).json({ error: 'A valid non-negative grace_days is required' });
  }
  if (interval_days === undefined || isNaN(interval_days) || interval_days < 1) {
    return res.status(400).json({ error: 'A valid interval_days of at least 1 is required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, fee_reminder_grace_days, fee_reminder_interval_days)
       VALUES ($1, $2, $3)
       ON CONFLICT (school_id) DO UPDATE SET
         fee_reminder_grace_days = EXCLUDED.fee_reminder_grace_days,
         fee_reminder_interval_days = EXCLUDED.fee_reminder_interval_days,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, grace_days, interval_days]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Fee reminder timing update error:', err);
    res.status(500).json({ error: 'Failed to update fee reminder timing' });
  }
});

// Low-attendance rolling-threshold alert config — same shape as
// fee-reminder-timing above. Defaults (75%, 30 days) are documented
// decisions in schema.sql, not hardcoded guesses a school is stuck with.
router.patch('/low-attendance-alert-timing', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { threshold_percent, window_days } = req.body;
  if (threshold_percent === undefined || isNaN(threshold_percent) || threshold_percent <= 0 || threshold_percent > 100) {
    return res.status(400).json({ error: 'A valid threshold_percent between 1 and 100 is required' });
  }
  if (window_days === undefined || isNaN(window_days) || window_days < 1) {
    return res.status(400).json({ error: 'A valid window_days of at least 1 is required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, low_attendance_threshold_percent, low_attendance_window_days)
       VALUES ($1, $2, $3)
       ON CONFLICT (school_id) DO UPDATE SET
         low_attendance_threshold_percent = EXCLUDED.low_attendance_threshold_percent,
         low_attendance_window_days = EXCLUDED.low_attendance_window_days,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, threshold_percent, window_days]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Low attendance alert timing update error:', err);
    res.status(500).json({ error: 'Failed to update low attendance alert timing' });
  }
});

// Upcoming-event parent reminder lead time — same shape as the other
// reminder-timing routes above.
router.patch('/event-reminder-timing', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { days_before } = req.body;
  if (days_before === undefined || isNaN(days_before) || days_before < 0) {
    return res.status(400).json({ error: 'A valid non-negative days_before is required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, event_reminder_days_before)
       VALUES ($1, $2)
       ON CONFLICT (school_id) DO UPDATE SET
         event_reminder_days_before = EXCLUDED.event_reminder_days_before,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, days_before]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Event reminder timing update error:', err);
    res.status(500).json({ error: 'Failed to update event reminder timing' });
  }
});

// Leaving-certificate letterhead/signatory text (feature 4.3) — lets the
// principal edit the PDF's per-school text without a code deploy. The PDF
// layout itself stays generic/shared; only this text is per-tenant.
router.patch('/leaving-cert', requireAuth, requirePrincipal, async (req, res) => {
  const school_id = req.user.school_id;
  const { leaving_cert_letterhead_text, leaving_cert_signatory_name, leaving_cert_signatory_designation } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO school_settings (school_id, leaving_cert_letterhead_text, leaving_cert_signatory_name, leaving_cert_signatory_designation)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (school_id) DO UPDATE SET
         leaving_cert_letterhead_text = COALESCE(EXCLUDED.leaving_cert_letterhead_text, school_settings.leaving_cert_letterhead_text),
         leaving_cert_signatory_name = COALESCE(EXCLUDED.leaving_cert_signatory_name, school_settings.leaving_cert_signatory_name),
         leaving_cert_signatory_designation = COALESCE(EXCLUDED.leaving_cert_signatory_designation, school_settings.leaving_cert_signatory_designation),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [school_id, leaving_cert_letterhead_text ?? null, leaving_cert_signatory_name ?? null, leaving_cert_signatory_designation ?? null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Leaving cert settings update error:', err);
    res.status(500).json({ error: 'Failed to update leaving certificate settings' });
  }
});

// Upload school logo to S3, save URL to DB, return updated settings.
router.post('/logo', requireAuth, requirePrincipal, (req, res, next) => {
  upload.single('logo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File must be under 2 MB' });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const key = `logos/${req.user.school_id}/${Date.now()}${ext}`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    const logo_url = s3PublicUrl(key);

    const result = await pool.query(
      `INSERT INTO school_settings (school_id, logo_url) VALUES ($1, $2)
       ON CONFLICT (school_id) DO UPDATE SET logo_url = EXCLUDED.logo_url, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [req.user.school_id, logo_url]
    );

    clearBrandingCache();
    res.json({ logo_url, settings: result.rows[0] });
  } catch (err) {
    console.error('S3 logo upload error:', err);
    res.status(500).json({ error: 'Upload failed — check S3 credentials and bucket policy' });
  }
});

export default router;
