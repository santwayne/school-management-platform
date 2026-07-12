// Normalizes one parsed CSV row (from the admin's "Upload biometric CSV" fallback)
// Expected parsed fields: employee_id, timestamp, type, device_serial (optional)
export function normalize(rawRow) {
  return {
    deviceInternalId: String(rawRow.employee_id || ''),
    deviceSerial: rawRow.device_serial || 'CSV_IMPORT',
    timestamp: new Date(rawRow.timestamp),
    punchType: ['in', 'out'].includes(String(rawRow.type).toLowerCase()) ? String(rawRow.type).toLowerCase() : 'unknown',
  };
}
