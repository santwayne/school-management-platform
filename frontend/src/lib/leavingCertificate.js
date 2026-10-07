// Shared School Leaving Certificate PDF builder (feature 4.3/4.5).
//
// One generic layout, shared by every school — only the letterhead text and
// signatory name/designation are per-tenant (configured in Admin Settings,
// see AdminSettings.jsx's "Leaving Certificate" card). Used from three
// places so the certificate always looks identical no matter where it was
// generated from:
//   - AdminCertificates.jsx        (principal generates on request)
//   - DocumentRequestQueue.jsx     (principal downloads from the approval queue)
//   - StudentCertificateRequest.jsx (student downloads their own APPROVED/READY request)
//
// v1 keeps document_url NULL for these — the PDF is regenerated client-side
// on demand from student + school_settings data rather than stored, since
// nothing here changes after issuance (see PR notes for the storage
// trade-off discussion).
import jsPDF from 'jspdf';
import { apiRequest } from '../api';

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

// student: { name, class_name, grade, login_id, parent_name, enrolled_at }
// settings: { school_name, leaving_cert_letterhead_text, leaving_cert_signatory_name, leaving_cert_signatory_designation }
// Optional branding (Settings -> Branding), both best-effort:
//   settings.brand_color    '#rrggbb' theme colour
//   settings.logo_data_url  the school logo as a PNG/JPEG data URL
// Without them the certificate looks exactly as it always did.
export function buildLeavingCertificatePDF(student, settings) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;

  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(settings.brand_color || '');
  const brand = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;

  // Logo, centred above the school name. Everything below moves down by its height.
  let top = 0;
  if (settings.logo_data_url) {
    try {
      const props = doc.getImageProperties(settings.logo_data_url);
      const scale = Math.min(40 / props.width, 20 / props.height);
      const w = props.width * scale;
      const h = props.height * scale;
      doc.addImage(settings.logo_data_url, props.fileType, centerX - w / 2, 10, w, h);
      top = h + 4;
    } catch {
      top = 0; // an unreadable logo never blocks the certificate
    }
  }

  // Letterhead
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  if (brand) doc.setTextColor(...brand);
  doc.text(settings.school_name || 'School', centerX, top + 20, { align: 'center' });

  if (settings.leaving_cert_letterhead_text) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100);
    const lines = doc.splitTextToSize(settings.leaving_cert_letterhead_text, pageWidth - 40);
    doc.text(lines, centerX, top + 28, { align: 'center' });
  }

  if (brand) {
    doc.setDrawColor(...brand);
    doc.setLineWidth(0.5);
  } else {
    doc.setDrawColor(180);
  }
  doc.line(20, top + 38, pageWidth - 20, top + 38);
  doc.setLineWidth(0.2);
  doc.setDrawColor(0);

  if (brand) doc.setTextColor(...brand);
  else doc.setTextColor(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('SCHOOL LEAVING CERTIFICATE', centerX, top + 52, { align: 'center' });

  doc.setTextColor(20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const bodyLines = [
    `Certificate No.: ${student.login_id || '—'}`,
    `Date of issue: ${fmtDate(new Date())}`,
    '',
    `This is to certify that ${student.name}${student.parent_name ? `, child of ${student.parent_name},` : ''} was a`,
    `bonafide student of this institution${student.class_name ? `, studying in Class ${student.class_name}` : ''}${student.grade ? ` (Grade ${student.grade})` : ''}.`,
    `${student.name} has been enrolled with us since ${fmtDate(student.enrolled_at)}.`,
    '',
    'This certificate is issued on request for the purpose of further studies / transfer.',
    'To the best of our knowledge, the conduct and character of the student have been satisfactory',
    'during the period of study at this institution.',
  ];
  doc.text(bodyLines, 20, top + 68, { lineHeightFactor: 1.7 });

  // Signatory block
  const signY = top + 165;
  doc.line(pageWidth - 80, signY, pageWidth - 20, signY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(settings.leaving_cert_signatory_name || 'Principal', pageWidth - 50, signY + 6, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(settings.leaving_cert_signatory_designation || 'Principal', pageWidth - 50, signY + 11, { align: 'center' });

  return doc;
}

// Async only because it first asks the server for the school's branding
// (theme colour + logo). If that fails the certificate is still produced,
// just without them.
export async function downloadLeavingCertificate(student, settings) {
  let branding = {};
  try {
    branding = (await apiRequest('/api/settings/branding')) || {};
  } catch {
    branding = {};
  }
  const doc = buildLeavingCertificatePDF(student, { ...settings, ...branding });
  doc.save(`leaving-certificate-${(student.name || 'student').replace(/\s+/g, '-').toLowerCase()}.pdf`);
}
