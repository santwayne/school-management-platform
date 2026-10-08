// The daily report goes out FROM the school's own WhatsApp number, and
// WhatsApp cannot deliver a message to the number that sends it. Returns the
// message to show when a report number is the school's number, else null.
const last10 = (phone) => String(phone ?? '').replace(/\D/g, '').slice(-10);

export function digestPhoneClash({ operator, principal, schoolNumber }) {
  const school = last10(schoolNumber);
  if (school.length !== 10) return null; // school WhatsApp not connected yet: nothing to clash with
  const who = [];
  if (operator && last10(operator) === school) who.push("Operator's");
  if (principal && last10(principal) === school) who.push("Principal's");
  if (who.length === 0) return null;
  return `${who.join(' and ')} WhatsApp number is the school's own WhatsApp number. The report is sent from that number, so it cannot receive it. Enter a personal number, or leave the field empty.`;
}
