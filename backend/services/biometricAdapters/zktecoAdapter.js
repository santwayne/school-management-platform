// Normalizes a ZKTeco ADMS/BioTime push payload into our standard shape.
// Payload shape (from the vendor's own webhook body): { SN, UserID, Time, Type }
export function normalize(rawPayload) {
  const punchTypeMap = { 0: 'in', 1: 'out', '0': 'in', '1': 'out' };
  return {
    deviceInternalId: String(rawPayload.UserID || ''),
    deviceSerial: rawPayload.SN || null,
    timestamp: new Date(rawPayload.Time),
    punchType: punchTypeMap[rawPayload.Type] || 'unknown',
  };
}
