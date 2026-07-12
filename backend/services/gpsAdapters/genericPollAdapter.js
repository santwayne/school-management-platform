// Reference implementation simulating a slowly moving vehicle around Toronto.
// Proves the pipeline (worker -> DB -> map) works end-to-end before any real
// vendor integration exists.
export async function pollLocations(bus) {
  const baseLat = 43.6532;
  const baseLng = -79.3832;
  const timeFactor = (Date.now() / 100000) % 0.05;

  return {
    latitude: baseLat + timeFactor,
    longitude: baseLng + timeFactor,
    speed_kmh: 45.5,
    recorded_at: new Date(),
    rawPayload: { info: 'Simulated reference telemetry trace log', deviceId: bus.vendor_device_id },
  };
}
