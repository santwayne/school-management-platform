import nodemailer from 'nodemailer';

// Transactional email over plain SMTP, so the provider can be swapped by
// changing .env only. Credentials live ONLY in the environment (SMTP_USER /
// SMTP_PASS) — never in code or the database.
//
// Never throws: callers get { sent: false, reason } and decide what to show.

let transporter = null;
let transporterKey = '';

export function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  const port = Number(process.env.SMTP_PORT || 465);
  // 465 = implicit TLS; 587/25 = STARTTLS. SMTP_SECURE overrides the guess.
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
  const key = [process.env.SMTP_HOST, port, secure, process.env.SMTP_USER].join('|');
  if (!transporter || key !== transporterKey) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
    transporterKey = key;
  }
  return transporter;
}

export function fromAddress() {
  return process.env.EMAIL_FROM || `Waynur <${process.env.SMTP_USER}>`;
}

export async function sendEmail({ to, subject, html, text }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) return { sent: false, reason: 'No recipient email address on file.' };
  if (!emailConfigured()) {
    console.warn(`[email] SMTP not configured (SMTP_HOST / SMTP_USER / SMTP_PASS) — "${subject}" not sent.`);
    return { sent: false, reason: 'Email is not configured on the server (SMTP_HOST / SMTP_USER / SMTP_PASS).' };
  }
  try {
    const info = await getTransporter().sendMail({
      from: fromAddress(),
      to: recipients.join(', '),
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
      subject,
      text,
      html,
    });
    return { sent: true, messageId: info.messageId, to: recipients };
  } catch (err) {
    console.error(`[email] "${subject}" to ${recipients.join(', ')} failed:`, err.message);
    return { sent: false, reason: err.message };
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "+919876543210" -> "+91 98765 43210" (other countries are left as typed).
export function prettyPhone(e164) {
  const m = /^\+91(\d{5})(\d{5})$/.exec(String(e164 || ''));
  return m ? `+91 ${m[1]} ${m[2]}` : String(e164 || '');
}

// The "your school's WhatsApp number is connected" notice for the principal.
// Contains the number only — never the Phone Number ID or any key.
export function whatsappConnectedEmail({ principalName, schoolName, number, verifiedName, connectedAt = new Date() }) {
  const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://waynur.com').replace(/\/$/, '');
  const support = process.env.EMAIL_REPLY_TO || process.env.SMTP_USER || 'info@waynur.com';
  const when = new Date(connectedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const phone = prettyPhone(number);
  const greeting = principalName ? `Dear ${principalName},` : 'Dear Principal,';
  const subject = `WhatsApp is now connected for ${schoolName}`;

  const rows = [
    ['School', schoolName],
    ['WhatsApp Business number', phone],
    ...(verifiedName ? [['Name shown to parents', verifiedName]] : []),
    ['Connected on', `${when} IST`],
    ['Status', 'Active'],
  ];
  const uses = [
    'Absence alerts to parents on the day a student is marked absent',
    'Fee reminders and secure payment links',
    'Class notes, homework and circulars',
    'Replies to parent queries and new admission enquiries',
  ];

  const text = [
    greeting,
    '',
    `We are pleased to confirm that the official WhatsApp Business number for ${schoolName} has been connected to your Waynur account.`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'From now on, messages from your school will be sent from this number, including:',
    ...uses.map((u) => `- ${u}`),
    '',
    'No action is needed from your side. You can view the connection status any time under Settings > WhatsApp in your Waynur dashboard:',
    `${siteUrl}/login`,
    '',
    `If you did not expect this change, or the number above is not correct, please reply to this email or write to ${support} and we will look into it immediately.`,
    '',
    'Warm regards,',
    'Team Waynur',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e8ee;">
  <tr><td style="background:#0f3d3e;padding:20px 28px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.3px;">Waynur</td></tr>
  <tr><td style="padding:28px;">
    <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#128c4a;text-transform:uppercase;letter-spacing:0.6px;">WhatsApp connected</p>
    <h1 style="margin:0 0 18px;font-size:21px;line-height:1.35;color:#102a43;">Your school's WhatsApp number is now active</h1>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${esc(greeting)}</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">We are pleased to confirm that the official WhatsApp Business number for <strong>${esc(schoolName)}</strong> has been connected to your Waynur account.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e8ee;border-radius:8px;margin:0 0 22px;">
      ${rows.map(([k, v], i) => `<tr>
        <td style="padding:11px 14px;font-size:13px;color:#627d98;width:44%;${i ? 'border-top:1px solid #e3e8ee;' : ''}">${esc(k)}</td>
        <td style="padding:11px 14px;font-size:14px;font-weight:600;color:#102a43;${i ? 'border-top:1px solid #e3e8ee;' : ''}">${esc(v)}</td>
      </tr>`).join('')}
    </table>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">From now on, messages from your school will be sent from this number, including:</p>
    <ul style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:1.7;">
      ${uses.map((u) => `<li>${esc(u)}</li>`).join('')}
    </ul>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;">No action is needed from your side. You can view the connection status any time under <strong>Settings &rsaquo; WhatsApp</strong> in your Waynur dashboard.</p>
    <p style="margin:0 0 24px;"><a href="${esc(siteUrl)}/login" style="display:inline-block;background:#0f3d3e;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px;">Open Waynur dashboard</a></p>
    <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#627d98;">If you did not expect this change, or the number above is not correct, please reply to this email or write to <a href="mailto:${esc(support)}" style="color:#0f3d3e;">${esc(support)}</a> and we will look into it immediately.</p>
    <p style="margin:0;font-size:15px;line-height:1.6;">Warm regards,<br><strong>Team Waynur</strong></p>
  </td></tr>
  <tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e3e8ee;font-size:12px;color:#829ab1;line-height:1.5;">This is a service notification about your Waynur account, sent to the principal's registered email address. Waynur will never ask you for a password or access key by email.</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}
