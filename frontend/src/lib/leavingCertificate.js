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

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

// student: { name, class_name, grade, login_id, parent_name, enrolled_at }
// settings: { school_name, leaving_cert_letterhead_text, leaving_cert_signatory_name, leaving_cert_signatory_designation }
export function buildLeavingCertificatePDF(student, settings) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;

  // Letterhead
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(settings.school_name || 'School', centerX, 20, { align: 'center' });

  if (settings.leaving_cert_letterhead_text) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100);
    const lines = doc.splitTextToSize(settings.leaving_cert_letterhead_text, pageWidth - 40);
    doc.text(lines, centerX, 28, { align: 'center' });
  }

  doc.setDrawColor(180);
  doc.line(20, 38, pageWidth - 20, 38);

  doc.setTextColor(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('SCHOOL LEAVING CERTIFICATE', centerX, 52, { align: 'center' });

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
  doc.text(bodyLines, 20, 68, { lineHeightFactor: 1.7 });

  // Signatory block
  const signY = 165;
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

export function downloadLeavingCertificate(student, settings) {
  const doc = buildLeavingCertificatePDF(student, settings);
  doc.save(`leaving-certificate-${(student.name || 'student').replace(/\s+/g, '-').toLowerCase()}.pdf`);
}
