# Deploy Handoff: Phase 2, Admission Enquiry Automation (backend)

Branch: `feat/p2-admission-automation` (built on Phase 1; also contains the WhatsApp phone-match hotfix)
Spec: `WAYNUR_AUTOMATION_SPEC.md` §3

## Ship the hotfix first
`fix/whatsapp-webhook-phone-match` is a separate one-commit branch off `master`. **Merge and deploy it on its own, now.** Meta sends `from` as `919876543210`; the DB stores `+919876543210`, so every inbound parent message was being dropped as "not OPTED_IN". In production today this means parents who reply to an absence alert still get the voice call, the doubt bot never answers, and fee-collector slip photos are never matched. Verified with a signed webhook: the reply now marks `notification_log` as `REPLIED`.

## What this adds
- **WhatsApp admission assistant** (`services/admissionAgent.js`). Any unknown number that writes in becomes an enquiry. It asks one question at a time (class, child, parent, area, transport), answers the fee **from `fee_structures` only** (range when sections differ), offers the next 3 free visit slots, and books with an atomic seat check. Replies in the parent's language (English / Hinglish / Hindi; Punjabi script gets Hindi for now). STOP / START honoured. Meta webhook retries are de-duplicated by message id.
  - Code runs the conversation; Claude (if `ANTHROPIC_API_KEY` is set) only extracts fields/intent and may answer general questions **strictly from the school knowledge base**. With no key it still works, rule-based.
  - Anything it can't handle becomes a Control Center inbox item: unanswerable question, call-back request / complaint (with "Pause assistant 24 h"), fee not configured, no visit slots, reply not delivered.
- **Which school?** One shared WhatsApp number serves every school, so an unknown sender is matched by (1) the school's own `whatsapp_phone_number_id`, if set; (2) the school's **admission code** in the message; (3) the only active school. Put the link from `GET /api/admissions/settings → whatsapp_link` on each school's website: it opens WhatsApp with "Admission enquiry <CODE>" pre-filled. Set `WHATSAPP_DISPLAY_NUMBER` for that link.
- **Follow-ups** (`workers/admissionFollowupWorker.js`, every 30 min): quiet enquiries get template reminders on days 1/3/7 (configurable), then move to Lost (no response). Visit reminders 24 h and 2 h before. After a visit ends, the inbox asks "Did X come?" with a one-click "Yes, they visited".
- **Operator API** `/api/admissions`: pipeline with stage counts and search, enquiry detail with the full chat, walk-in entry, edit, reply (only inside WhatsApp's 24 h window; replying pauses the assistant for 24 h), pause/resume, visit outcome, **Admit** (creates parent + student in one transaction, reuses the parent for siblings, enforces section choice and `classes.seat_capacity`, carries WhatsApp opt-in only if consent was given), visit slots (bulk create), knowledge base, settings, funnel stats.
- **Public API** `/api/public/admissions/:slug`: school name + classes, and the website enquiry form (rate-limited, honeypot, consent required). Sends the `admission_welcome` template.

## WhatsApp templates to submit (Utility, `en`)
| Name | Params | Body |
|---|---|---|
| `admission_welcome` | parent, school | Hi {{1}}, thank you for your admission enquiry at {{2}}! Reply here to ask about fees, book a campus visit, or anything else. |
| `admission_followup` | parent, school | Hi {{1}}, this is {{2}}. Do you have any questions about admission? Reply here and we'll help. Reply STOP to opt out. |
| `visit_reminder` | parent, school, date/time | Hi {{1}}, a reminder of your visit to {{2}} on {{3}}. Reply here if you need to change the time. |

## Env vars (optional)
`WHATSAPP_DISPLAY_NUMBER` (for the website link), `WHATSAPP_ADMISSION_WELCOME_TEMPLATE`, `WHATSAPP_ADMISSION_FOLLOWUP_TEMPLATE`, `WHATSAPP_VISIT_REMINDER_TEMPLATE`.

## Tested locally (real server, signed webhooks)
- Full Hinglish conversation to a booked visit; the parent asking "fee kitni hai?" mid-flow gets the fee and the pending question again (**bug found and fixed**: the question was being saved as the child's name).
- Full slot, so the next free times are offered (**bug fixed**: other free slots were being excluded). Hindi-script enquiry parsed (**fixed**: Devanagari class keywords). "Class 8A"-style names parsed (**fixed**: fees for sectioned classes never matched). Capacity 0 blocks admission (**fixed**: 0 was treated as unlimited).
- Duplicate webhook stored once. STOP silences all messages. Two active schools + no code means not attributed; with code, the right school.
- Admit: section required when ambiguous, second admit refused, parent created OPTED_IN with consent.
- Follow-up schedule 24 h, 48 h, 96 h; visit-outcome inbox item and one-click action work; runs recorded in the Control Center.
- `npm test`: 14/14.

**Not tested:** real WhatsApp delivery and real Claude replies (sandbox has no access). On staging, run one conversation end to end from a real phone.

## Known gaps
- **Frontend screens for admissions are not in this commit** (pipeline, chat view, slots, knowledge base, public form page). API is complete.
- Application form / document upload / online admission fee (spec §3.1 steps 6–7) not built yet; the operator admits directly after the visit.
- Punjabi (Gurmukhi) replies fall back to Hindi.
- The DB session timezone is Asia/Kolkata (set by the app), so `timestamp` columns hold IST wall-clock. Queries run from a plain `psql` (UTC) will look 5.5 h off; that's expected.
