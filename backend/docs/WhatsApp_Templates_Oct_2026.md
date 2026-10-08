# WhatsApp templates reworded in October 2026

The 7-8 Oct template test found five messages whose wording needed more than a
code fix. An approved Meta template cannot gain a variable, or change
category, without every send failing in between, so each one is a **new
template name**. The old templates stay approved and keep working until this
code is deployed.

## Order of work

1. Create the templates below in WhatsApp Manager, in every WhatsApp account
   in use, and wait until each shows **Active**.
2. Deploy. `schema.sql` runs on boot and moves the global rows in
   `notification_templates` to the new names.
3. Trigger each message once and read it on the phone.
4. Delete the old templates on Meta.

Deploying before step 1 is finished makes these messages fail until the
templates are approved. The library digest alone can be held back with
`WHATSAPP_LIBRARY_DIGEST_TEMPLATE=library_due_digest`.

## Templates

All are category **Utility**, language **English**, no header, footer or buttons.

| New template | Replaces | Status on 8 Oct |
|---|---|---|
| `recurring_doubt_class_update` | `recurring_doubt_signal_alert` | Submitted, in review |
| `staff_leave_pending_review_alert` | `staff_leave_pending_reminder_alert` | To create |
| `petty_cash_pending_review_alert` | `petty_cash_pending_reminder_alert` | To create |
| `low_attendance_threshold_alert` | `low_attendance_alert` | To create |
| `library_overdue_digest` | `library_due_digest` | To create |

### recurring_doubt_class_update

    Class update for {{2}}: {{3}} students asked questions about {{1}} this week. You can review the questions in the teacher portal.

`{{1}}` chapter, `{{2}}` class, `{{3}}` number of students. Samples: Fractions, Class 8A, 6.
Same variables as before; the old template was filed under Marketing.

### staff_leave_pending_review_alert

    Reminder: {{1}} has requested {{2}} leave ({{3}}, {{4}} to {{5}}) and it is pending approval. Please review it in the school portal.

`{{1}}` teacher, `{{2}}` leave type, `{{3}}` length with its unit, `{{4}}` first day, `{{5}}` last day.
Samples: Amanpreet Singh, casual, 3 days, 8 Oct 2026, 10 Oct 2026.

### petty_cash_pending_review_alert

    Reminder: a petty cash request from {{1}} for Rs. {{2}} has been pending approval for {{3}}. Please review it in the school portal.

`{{1}}` requested by, `{{2}}` amount, `{{3}}` wait with its unit. Samples: Amanpreet Singh, 500, 3 days.

### low_attendance_threshold_alert

    Attendance alert: {{1}}'s attendance is {{2}}% over the last {{3}} days, which is below the school minimum of {{4}}%. Please contact the school office if you need help.

`{{1}}` student, `{{2}}` attendance, `{{3}}` window in days, `{{4}}` school minimum. Samples: Aarav Mehta, 62.5, 30, 75.

### library_overdue_digest

    Library update: overdue books: {{1}}. Details: {{2}}. Due today or tomorrow: {{3}}. Please remind borrowers to return books on time.

`{{1}}` overdue count, `{{2}}` up to five books, oldest first, then "and N more", `{{3}}` books due today or tomorrow.
Samples: 2, Maths Book 6 - Aarav Mehta (Class 6A), 3 days late; Science Reader - Simran Kaur (Class 7B), 1 day late, 1.
Sent only when at least one book is overdue.

## Edited in place

`upcoming_event_reminder_alert` kept its three variables, so it was edited on
Meta directly on 8 Oct and needs no code change:

    Reminder: {{1}} is scheduled on {{2}}, in {{3}} days. Please check the school portal for details.

A school that sets its event reminder to one day before will read "in 1 days".
