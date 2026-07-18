import express from 'express';
import pool from '../config/db.js';
import { requireAuth, requireSuperAdmin, requirePrincipal } from '../middleware/auth.js';
import { triggerVapiCall } from '../services/voiceService.js';

const router = express.Router();

function mask(key) {
  if (!key) return null;
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}${'•'.repeat(Math.max(4, key.length - 8))}${key.slice(-4)}`;
}

async function getConfig() {
  const { rows } = await pool.query('SELECT * FROM ai_voice_tutor_config WHERE id = 1');
  return rows[0] || null;
}

// ---------- Super admin: connect / manage the Vapi integration ----------

// GET /api/super-admin/ai-voice-tutor — current wiring status (key masked)
router.get('/', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg) {
      return res.json({ connected: false, enabled: false });
    }
    res.json({
      connected: !!cfg.vapi_api_key,
      enabled: cfg.enabled,
      vapi_api_key_masked: mask(cfg.vapi_api_key),
      vapi_phone_number_id: cfg.vapi_phone_number_id,
      assistant_id_english: cfg.assistant_id_english,
      assistant_id_hindi: cfg.assistant_id_hindi,
      assistant_id_punjabi: cfg.assistant_id_punjabi,
      updated_at: cfg.updated_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/super-admin/ai-voice-tutor — save/update the Vapi wiring.
// vapi_api_key is optional on update (omit to keep the existing key while
// changing other fields) — avoids forcing a re-paste of the secret every time.
router.put('/', requireAuth, requireSuperAdmin, async (req, res) => {
  const { vapi_api_key, vapi_phone_number_id, assistant_id_english, assistant_id_hindi, assistant_id_punjabi, enabled } = req.body;

  try {
    const existing = await getConfig();
    const keyToUse = vapi_api_key !== undefined && vapi_api_key !== '' ? vapi_api_key : existing?.vapi_api_key || null;

    const { rows } = await pool.query(
      `INSERT INTO ai_voice_tutor_config (id, vapi_api_key, vapi_phone_number_id, assistant_id_english, assistant_id_hindi, assistant_id_punjabi, enabled)
       VALUES (1, $1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         vapi_api_key = EXCLUDED.vapi_api_key,
         vapi_phone_number_id = EXCLUDED.vapi_phone_number_id,
         assistant_id_english = EXCLUDED.assistant_id_english,
         assistant_id_hindi = EXCLUDED.assistant_id_hindi,
         assistant_id_punjabi = EXCLUDED.assistant_id_punjabi,
         enabled = EXCLUDED.enabled,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        keyToUse,
        vapi_phone_number_id || null,
        assistant_id_english || null,
        assistant_id_hindi || null,
        assistant_id_punjabi || null,
        enabled ?? existing?.enabled ?? false,
      ]
    );
    const cfg = rows[0];
    res.json({ connected: !!cfg.vapi_api_key, enabled: cfg.enabled, vapi_api_key_masked: mask(cfg.vapi_api_key) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/super-admin/ai-voice-tutor/test-call — "join voice": place a real
// test call right from the panel to confirm the Vapi wiring actually works
// before enabling it for any school.
router.post('/test-call', requireAuth, requireSuperAdmin, async (req, res) => {
  const { phone, language = 'en' } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required (E.164, e.g. +9198XXXXXXXX)' });

  try {
    const cfg = await getConfig();
    if (!cfg?.vapi_api_key || !cfg?.vapi_phone_number_id) {
      return res.status(400).json({ error: 'Vapi API key and phone number ID must be saved before testing.' });
    }
    const assistantId = { en: cfg.assistant_id_english, hi: cfg.assistant_id_hindi, pa: cfg.assistant_id_punjabi }[language];
    if (!assistantId) {
      return res.status(400).json({ error: `No assistant ID configured for language "${language}".` });
    }

    const call = await triggerVapiCall({
      apiKey: cfg.vapi_api_key,
      phoneNumberId: cfg.vapi_phone_number_id,
      assistantId,
      toPhone: phone,
      variableValues: { student_name: 'Test Student', subject: 'General' },
    });

    res.json({ success: true, vapi_call_id: call.id || call.callId || null });
  } catch (err) {
    const detail = err.response?.data || err.message;
    res.status(502).json({ error: 'Vapi call failed', detail });
  }
});

// PUT /api/super-admin/schools/:schoolId/voice-tutor — enable/disable for one school
router.put('/schools/:schoolId', requireAuth, requireSuperAdmin, async (req, res) => {
  const { enabled } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO school_settings (school_id, voice_tutor_enabled) VALUES ($1, $2)
       ON CONFLICT (school_id) DO UPDATE SET voice_tutor_enabled = EXCLUDED.voice_tutor_enabled, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [req.params.schoolId, !!enabled]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- School side: principal/teacher starts a real tutoring call ----------

// POST /api/super-admin/ai-voice-tutor/start — starts a live voice tutor call
// to a student/parent phone. Gated on both the global platform switch and
// this school's own voice_tutor_enabled flag.
router.post('/start', requireAuth, requirePrincipal, async (req, res) => {
  const { student_id, phone, subject, language = 'en' } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  try {
    const settingsRes = await pool.query('SELECT voice_tutor_enabled FROM school_settings WHERE school_id = $1', [req.user.school_id]);
    if (!settingsRes.rows[0]?.voice_tutor_enabled) {
      return res.status(403).json({ error: 'AI Voice Tutor is not enabled for this school yet — ask your platform admin to turn it on.' });
    }

    const cfg = await getConfig();
    if (!cfg?.enabled || !cfg?.vapi_api_key) {
      return res.status(503).json({ error: 'AI Voice Tutor is not connected on the platform side yet.' });
    }
    const assistantId = { en: cfg.assistant_id_english, hi: cfg.assistant_id_hindi, pa: cfg.assistant_id_punjabi }[language];
    if (!assistantId) {
      return res.status(400).json({ error: `No assistant configured for language "${language}".` });
    }

    let call;
    let status = 'INITIATED';
    let error = null;
    try {
      call = await triggerVapiCall({
        apiKey: cfg.vapi_api_key,
        phoneNumberId: cfg.vapi_phone_number_id,
        assistantId,
        toPhone: phone,
        variableValues: { subject: subject || 'General' },
      });
    } catch (err) {
      status = 'FAILED';
      error = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    }

    const { rows } = await pool.query(
      `INSERT INTO ai_voice_tutor_call_log (school_id, student_id, phone, subject, language, vapi_call_id, status, error, initiated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.user.school_id, student_id || null, phone, subject || null, language, call?.id || call?.callId || null, status, error, req.user.teacher_id]
    );

    if (status === 'FAILED') return res.status(502).json({ error: 'Call failed to start', detail: error, log: rows[0] });
    res.status(200).json({ success: true, log: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/super-admin/ai-voice-tutor/school-status — school-side check of whether it's enabled for them
router.get('/school-status', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT voice_tutor_enabled FROM school_settings WHERE school_id = $1', [req.user.school_id]);
    res.json({ enabled: rows[0]?.voice_tutor_enabled || false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
