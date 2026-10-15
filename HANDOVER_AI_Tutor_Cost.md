# Handover — AI Tutor cost reduction

Branch: `feat/ai-tutor-cost-reduction` (on top of master `bfa0fc8`, after PR #83)

## What changed and why

| Change | File(s) | Effect on cost |
|---|---|---|
| Tutor model is now `claude-haiku-4-5` (was `claude-sonnet-5`), set by `TUTOR_MODEL` | `services/tutorService.js` | ~3x cheaper per token |
| Prompt caching: fixed tutor rules (same for every student), then the student's own block (grade, subject, **full** learning memory), then earlier chat turns — each cached | `services/tutorService.js` | Repeated parts billed at 10% of input price |
| Only the recent part of a session is re-sent each turn (12–20 messages). Window jumps in blocks of 8 so the cached prefix stays the same for several turns. Full session is still saved in `tutor_sessions` and still used for student memory | `services/tutorService.js` | Long sessions no longer grow in cost every turn |
| Reply cap 500 → 300 tokens, prompt asks for 2–4 sentences, keeps the student on schoolwork | `services/tutorService.js` | Output tokens (5x price of input) down |
| Student message capped at 2,000 characters | `routes/tutor.js` | Stops huge pastes |
| Every tutor call is metered into new table `ai_usage_log` (tokens, cache hits, ₹ cost) | `services/aiUsage.js`, `models/schema.sql`, `routes/tutor.js` | Real AI bill per school/student |
| Optional monthly per-student tutor quota (`TUTOR_MONTHLY_TOKEN_CAP`). When used up the tutor returns 429 `tutor_quota_exhausted` | `routes/tutor.js`, `services/aiUsage.js` | Hard ceiling on cost |
| `GET /api/tutor/usage` — student's tokens used / left / approx minutes left this month | `routes/tutor.js` | For the dashboard + future recharge |
| `GET /api/super-admin/ai-usage?month=YYYY-MM` — AI cost per school, tutor cost per student | `routes/superAdmin.js` | Margin tracking |
| WhatsApp doubt hint + chapter tagging use `DOUBT_MODEL` (default Haiku) | `services/aiService.js` | ~3x cheaper |

**Not changed on purpose:** student memory (`services/studentMemory.js`) — kept full and on its current model. Receipt/slip reading and broadcast drafting keep their model.

**Privacy:** the only shared cached part is the fixed tutor rules text, which contains no student data. Each student's memory and chat are in their own blocks and are never shared with another student or school. A test checks this.

## Deploy (EC2)

```bash
cd /home/ubuntu/school-management-platform
git fetch && git checkout master && git pull origin master   # after merging the PR
cd backend && npm install && npm run migrate                 # creates ai_usage_log
pm2 restart waynur-backend --update-env
```

No frontend rebuild needed (the existing tutor UI already shows the server's error text, including the quota message).

## .env (all optional — defaults in brackets)

```
TUTOR_MODEL=claude-haiku-4-5        # [claude-haiku-4-5]
TUTOR_MAX_TOKENS=300                # [300]
TUTOR_HISTORY_MIN_KEEP=12           # [12]
TUTOR_HISTORY_STEP=8                # [8]
TUTOR_MAX_MESSAGE_CHARS=2000        # [2000]
TUTOR_MONTHLY_TOKEN_CAP=            # [empty = no limit]; 250000 ≈ 90 min/month
TUTOR_TOKENS_PER_MINUTE=2500        # [2500] only for "minutes left"
DOUBT_MODEL=claude-haiku-4-5        # [claude-haiku-4-5]
USD_INR=88                          # [88]
```

Suggested rollout: deploy with **no cap** for 2 weeks, read `/api/super-admin/ai-usage`, then set `TUTOR_MONTHLY_TOKEN_CAP` from real numbers.

## Test

```bash
cd backend && node --test tests/tutorCost.test.js
```

Manual check after deploy:
1. Student portal → AI Tutor → have a 10+ message chat. Replies should be short and still guide (not give answers).
2. `SELECT feature, model, input_tokens, output_tokens, cache_read_tokens, cost_inr FROM ai_usage_log ORDER BY id DESC LIMIT 10;` — rows appear; `cache_read_tokens` > 0 from about the 3rd–4th message in a session.
3. Set `TUTOR_MONTHLY_TOKEN_CAP=1000`, restart, send a message → "You have used all your AI Tutor time for this month." Then remove the cap again.

## Note on caching

Anthropic only caches a prompt prefix once it is long enough (around 2,000 tokens on Haiku). The tutor rules + student memory alone are shorter than that, so caching starts paying off once a session has a few turns of history. That is expected — the model switch, shorter replies and history window give the savings from the first message.
