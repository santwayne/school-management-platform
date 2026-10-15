import pool from '../config/db.js';

// Token metering for every AI call we want to cost-track. Each call writes one
// row to ai_usage_log, so the Super Admin can see the real AI bill per school
// and per student, and the tutor can enforce a monthly per-student quota.
//
// Prices are USD per 1M tokens (Anthropic list prices). Cache writes cost
// 1.25x input, cache reads 0.1x input. Unknown models fall back to the most
// expensive known row so cost is never under-reported.
const PRICES = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
};
const FALLBACK = { input: 3, output: 15 };

export function priceFor(model) {
  const key = Object.keys(PRICES).find((k) => String(model || '').startsWith(k));
  return key ? PRICES[key] : FALLBACK;
}

export function usdInr() {
  const v = Number(process.env.USD_INR);
  return Number.isFinite(v) && v > 0 ? v : 88;
}

// usage: the `usage` object from an Anthropic messages.create response.
export function totalTokens(usage = {}) {
  return (usage.input_tokens || 0) + (usage.output_tokens || 0)
    + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
}

export function costInr(model, usage = {}) {
  const p = priceFor(model);
  const usd = ((usage.input_tokens || 0) * p.input
    + (usage.cache_creation_input_tokens || 0) * p.input * 1.25
    + (usage.cache_read_input_tokens || 0) * p.input * 0.1
    + (usage.output_tokens || 0) * p.output) / 1e6;
  return Math.round(usd * usdInr() * 10000) / 10000;
}

// Never throws — metering must not break the feature it measures.
export async function logAiUsage({ schoolId, studentId = null, feature, model, usage, refId = null }) {
  try {
    if (!usage) return;
    await pool.query(
      `INSERT INTO ai_usage_log (school_id, student_id, feature, model, input_tokens, output_tokens,
         cache_write_tokens, cache_read_tokens, cost_inr, ref_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [schoolId, studentId, feature, model, usage.input_tokens || 0, usage.output_tokens || 0,
        usage.cache_creation_input_tokens || 0, usage.cache_read_input_tokens || 0, costInr(model, usage), refId]
    );
  } catch (err) {
    console.error('[aiUsage] could not log usage:', err.message);
  }
}

// ---- Tutor quota ----
// TUTOR_MONTHLY_TOKEN_CAP = tokens per student per calendar month (0/empty = no cap).
// TUTOR_TOKENS_PER_MINUTE = rough conversion used only to show "minutes left".
export function tutorMonthlyCap() {
  const v = Number(process.env.TUTOR_MONTHLY_TOKEN_CAP);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function tokensPerMinute() {
  const v = Number(process.env.TUTOR_TOKENS_PER_MINUTE);
  return Number.isFinite(v) && v > 0 ? v : 2500;
}

export async function tutorTokensThisMonth(studentId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(input_tokens + output_tokens + cache_write_tokens + cache_read_tokens), 0)::bigint AS used
       FROM ai_usage_log
      WHERE student_id = $1 AND feature = 'tutor'
        AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
    [studentId]
  );
  return Number(rows[0]?.used || 0);
}

export async function tutorQuotaFor(studentId) {
  const cap = tutorMonthlyCap();
  const used = await tutorTokensThisMonth(studentId);
  const left = cap ? Math.max(0, cap - used) : null;
  return {
    cap: cap || null,
    used,
    left,
    exhausted: cap ? used >= cap : false,
    minutes_left: cap ? Math.floor(left / tokensPerMinute()) : null,
  };
}
