# Deploy Handoff: Phase 3, Parent WhatsApp Assistant (backend)

Branch: `feat/p3-parent-assistant` (on top of Phase 2)
Spec: `WAYNUR_AUTOMATION_SPEC.md` §4

## The problem it fixes
Before this, every message from an opted-in parent was treated as a homework doubt. "Fees kitni baaki hai?" got a homework hint back. (And because of the phone-format bug fixed on `fix/whatsapp-webhook-phone-match`, parents got nothing at all. **This phase needs that fix.**)

## What it does
Typed parent messages go through `services/parentAssistant.js` first:

| Parent says | Assistant does (data source) |
|---|---|
| fees kitni baaki hai | balance incl. unpaid transport (`student_payment`, `student_transport_fees`) |
| pay / payment link | creates a Razorpay link with the same function the Fees screen uses |
| receipt | last 5 payments |
| homework | today/tomorrow's homework for the child's class |
| attendance | last 30 days %, absent dates |
| result | latest **published** exam, subject marks and total |
| chutti kab hai / events | next 30 days, `audience` all/parents only (staff events hidden) |
| bus kahan hai | last GPS point (≤ 10 min old) and distance from the child's home; otherwise says live location unavailable |
| timetable / kal kya hai | today's or tomorrow's periods |
| "Aman kal nahi aayega" | creates a PENDING `student_leave_requests` row (aaj / kal / parso / "3 din" / 28/9); asks for the date if missing; blocks duplicates |
| certificate / TC | creates a `document_requests` row; **TC also raises a high inbox item** (family may be leaving: worth a call) |
| teacher se baat | class teacher's dashboard notification + inbox item |
| complaint | high inbox item with "pause assistant" action |
| **bullying / hit / abuse / unsafe** | **no advice given**; tells the parent the principal has been informed (and 112 if in danger); **critical** inbox item |
| reply to today's absence alert | "Thank you, noted, you won't get a call" (the voice call is already cancelled) |
| menu / help | list of what it can do |
| anything else (subject questions) | **existing homework doubt pipeline, unchanged** |

- **Which child:** by first name in the message, else the child from the last 30 minutes, else it asks "1. Aman 2. Riya". Every reply names the child.
- **Privacy:** every query is keyed by a student id taken from `students WHERE parent_id = <this parent>`. There is no path to another family's data.
- **Language:** Hindi/Punjabi script gets Hindi for the important messages (the rest in Hinglish); Hinglish words give Hinglish; a clear English sentence gives English; short messages ("menu", "1") keep the conversation's language or the parent's saved preference.
- **AI:** keywords first. If none match and `ANTHROPIC_API_KEY` is set, Claude only picks an intent label. It never writes facts.
- **Guards:** Meta retries de-duplicated by message id; > 30 messages/hour from one parent pauses replies and raises a low inbox item; failed sends are recorded; any crash raises an inbox item so the parent isn't left unanswered.
- **Operator:** `/api/parent-conversations`: list with 7-day stats (answered by assistant / doubts / escalated / failed sends / by intent), thread view, staff reply (24 h window; replying pauses the assistant for 24 h), takeover. Inbox action `parent.takeover` is offered on complaints and safety alerts.

## Before deploy
- Needs the phone-match hotfix.
- No new WhatsApp templates: every reply is inside the 24 h window the parent opened.
- For bus answers, students need `home_latitude/longitude` and a `student_transport_fees` row; buses need GPS.

## Tested locally (signed webhooks, real DB)
Two-child parent: which-child question then fee with transport (₹16,500); homework; attendance 86% with dates; holidays (staff meeting correctly hidden); bus 1.9 km, 3 min ago; leave for "kal" created, duplicate refused; bonafide request; bullying message gives a critical alert and one-click takeover, after which the bot stays silent and the staff reply goes out; subject question goes to the doubt bot; Razorpay unavailable gives the parent a clear reply and a medium inbox item; cross-school parent id returns 404.
**Bug found and fixed:** short Hinglish messages ("attendance batao") were answered in English.
`npm test`: 20/20.

## Known gaps
- Frontend "Parent messages" screen not built yet (API complete).
- Voice notes are still ignored (no transcription provider chosen).
- Punjabi-script messages get Hindi/Hinglish replies.
- Remembered child: if a two-child parent asks without a name within 30 min of talking about the other child, the answer is for the remembered child (the reply names them, so it's visible).
