# AI Automation Roadmap — School Management Platform

Status: **plan only, nothing below is built yet.** Written for later planning. Origin: the student learning memory idea (Waynur team) and the Ask AI assistant already delivered.

## 1. What already exists (foundation)
| Piece | What it gives us |
|---|---|
| Ask AI (Control Center + WhatsApp for principal/operator) | Natural-language access to school records, document drafting (PDF), approval-gated actions |
| Assistant memory + weekly self-review | School-specific knowledge; lessons/ideas that a person approves |
| Student learning memory | Per-student strengths, struggles, interests, pace; used by the AI tutor and visible to staff |
| Control Center (inbox, automation registry, audit log, approvals) | Where AI proposals, approvals and monitoring already live |
| WhatsApp (templates, inbound webhook, opt-in) | Delivery channel to parents, staff, principal |
| Existing AI: tutor, parent assistant, admission assistant, grading, timetable generator, performance drift | Reusable prompts and data access |

## 2. Principles (apply to every item)
1. **AI proposes, a person approves** for anything that messages parents, changes a record or touches money — until a feature has a proven track record, then loosen per feature.
2. **Facts come from the database, AI only phrases and prioritises.** Never let the model invent numbers, names or dates.
3. **Children's data: learning-related only.** No family, health, religion, appearance or character judgements. Check privacy policy / parent consent before any AI-written note about a child leaves the school.
4. **Everything is logged** (Activity log) and reversible where possible.
5. **Cost-aware:** cache, batch overnight, cap per school per day, fall back to rules when no AI key.
6. **One automation at a time**, measured before the next.

## 3. The ideas

### A. Build on student memory (biggest differentiator)
**A1. Early-warning per student**
- *What:* Combine attendance dips, falling marks, tutor struggles, repeated leave and fee patterns into a weekly "needs attention" list with a plain-English reason and a suggested first step.
- *Data:* attendance, exam_marks, tutor_sessions + student_learning_profiles, student_leave_requests, observations.
- *Build on:* `performanceDriftWorker`, Control Center inbox (raise as exceptions with a suggested action).
- *Effort:* Medium. *Risk:* false alarms → start with a high threshold, show the evidence. *Success:* teachers act on ≥ 50% of flags; fewer surprise failures.

**A2. Parent weekly progress note (WhatsApp, parent's language)**
- *What:* Personal 3–4 line note per student ("improving at step-by-step reasoning; 10 min on fractions this week would help"), built from the learning profile + the week's facts.
- *Rules:* teacher approves in a batch screen at first; consent flag per parent; positive-first, no labels like "weak".
- *Build on:* `weeklyProgressSummaryWorker`, WhatsApp templates (needs a Meta-approved template), `parents.opt_in_status`.
- *Effort:* Medium. *Risk:* sensitivity of notes about children → approval + consent. *Success:* parent reply rate, opt-out rate stays low.

**A3. Personalised practice & homework**
- *What:* Generate extra practice for each child's weak areas, themed on their interests; teacher can assign with one click.
- *Build on:* learning profile, `generateTestWithRubric`, homework drafts (already one-time-share capable).
- *Effort:* Medium. *Risk:* wrong content → always draft, teacher reviews.

**A4. Morning briefing for each teacher**
- *What:* One short WhatsApp/dashboard note per teacher: who is struggling, who is ahead, who was absent yesterday, what to try today.
- *Build on:* timetable + learning profiles + attendance; teacher WhatsApp already wired.
- *Effort:* Low–Medium.

### B. Make the Control Center proactive
**B1. Daily "what I would do" plan for the principal**
- *What:* Each morning Ask AI sends the principal (WhatsApp + panel) the top 3 actions with reasoning and one-tap approve where possible.
- *Build on:* `dailyDigestWorker` (already writes a line), Ask AI tools, assistant_actions.
- *Effort:* Low–Medium. *Success:* % of suggestions approved.

**B2. Fee recovery assistant**
- *What:* Predict who is likely to pay late; draft the right reminder tone per family; principal approves the batch.
- *Build on:* `feeReminderWorker`, fee dues, payment history, Razorpay links.
- *Risk:* money + family sensitivity → approval mandatory, polite templates only.

**B3. Admissions conversion scoring**
- *What:* Rank enquiries by likelihood to join; tell staff who to call first and what to say.
- *Build on:* admission_enquiries, admissionAgent conversation state.
- *Effort:* Low–Medium.

### C. Save staff time
**C1. Parent message triage** — classify incoming parent messages (complaint, safety, leaving, routine), draft replies, raise urgent ones in the inbox. *Build on:* `parentAssistant`, `parentConversations`.
**C2. Auto-generated documents** — circular/report-card comment/minutes templates, scheduled (e.g. "every Friday, draft the weekly circular"). *Build on:* Ask AI `create_document` + PDF.
**C3. AI-assisted substitution & timetable** — suggest swaps using lesson plans and workload; keep the deterministic solver as the fallback. *Build on:* `substitutionService`, `timetableSolver`.
**C4. Voice note → structured record** — teacher sends a WhatsApp voice note; it becomes observations on the right students' profiles (needs transcription). *Build on:* teacher WhatsApp handler, `student_observations`, learning memory.

### D. The software improves itself (safely)
**D1. Automation health coach** — turn weekly-review ideas into ready-to-approve fix proposals or developer tickets.
**D2. Natural-language reports/charts** — "fee collection by class this quarter" → downloadable report. Small step from Ask AI.
**D3. Data-quality sweeper** — find duplicate students, missing phones, wrong or missing fee amounts; propose cleanups for approval.

## 4. Suggested order
| Phase | Items | Why first |
|---|---|---|
| 1 | A1 early-warning + B1 morning plan | Reuse existing data/code; most visible value to a principal |
| 2 | A2 parent weekly progress | Strongest differentiator; needs Meta template + consent decision |
| 3 | C4 voice notes, A4 teacher briefing | Teachers adopt it; feeds the memory |
| 4 | A3, B2, B3, C1 | Higher effort / more sensitivity |
| 5 | C2, C3, D1–D3 | Polish and self-improvement |

## 5. Before building anything in phase 1–2 (decisions needed)
1. Parent/guardian **consent wording** for AI-written learning notes.
2. Who approves parent-facing notes (class teacher vs principal)?
3. Languages to support (English / Hindi / Punjabi / Hinglish).
4. Meta WhatsApp **template approvals** (lead time).
5. Monthly AI **cost budget** per school and per student.
6. Data retention: how long learning profiles are kept, and what happens when a student leaves.

## 6. How we will know it works (measure each)
- Teacher action rate on early-warning flags; false-alarm rate.
- Principal approval rate on daily suggestions.
- Parent reply / opt-out rates; fee collection days-to-pay.
- Time saved (staff survey), AI cost per school per month.
- Assistant thumbs-up ratio from the weekly review.

## 7. Risks
| Risk | Mitigation |
|---|---|
| Wrong or insensitive note about a child | Learning-only prompt rules, teacher approval, staff can correct/clear |
| Hallucinated numbers | Facts from SQL, model only phrases; tools return data, not guesses |
| Parent backlash / opt-outs | Opt-in, positive-first tone, easy STOP |
| Cost growth | Batch overnight, caps, cache, rules fallback |
| Over-trust | Keep approval gates; show evidence with every suggestion |
| Prompt injection from messages/notes | Treat all stored text as data (already done in Ask AI) |
