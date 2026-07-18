// Generic REST-polling adapter. Most GPS vendors expose some kind of
// "get current location for device X" REST endpoint that returns JSON with
// lat/lng somewhere in it — this adapter works with any of them by letting
// the admin configure the base URL, API key, and dot-notation paths to the
// lat/lng/speed/timestamp fields in the response, instead of us needing a
// bespoke integration per vendor.
//
// Example vendor_api_base_url: "https://api.trackmybus.example/v1/devices/{device_id}/location"
// ({device_id} is substituted with the bus's vendor_device_id)

function getByPath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export async function pollLocations(bus) {
  if (!bus.vendor_api_base_url) {
    throw new Error('No vendor_api_base_url configured for this bus');
  }

  const url = bus.vendor_api_base_url.replace('{device_id}', encodeURIComponent(bus.vendor_device_id || ''));

  const res = await fetch(url, {
    headers: bus.vendor_api_key ? { Authorization: `Bearer ${bus.vendor_api_key}` } : {},
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`Vendor API responded ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const body = await res.json();

  const latitude = Number(getByPath(body, bus.vendor_lat_path || 'lat'));
  const longitude = Number(getByPath(body, bus.vendor_lng_path || 'lng'));
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new Error(`Could not find valid lat/lng at configured paths in vendor response`);
  }

  const speedRaw = bus.vendor_speed_path ? getByPath(body, bus.vendor_speed_path) : null;
  const tsRaw = bus.vendor_timestamp_path ? getByPath(body, bus.vendor_timestamp_path) : null;

  return {
    latitude,
    longitude,
    speed_kmh: speedRaw != null ? Number(speedRaw) : null,
    recorded_at: tsRaw ? new Date(tsRaw) : new Date(),
    rawPayload: body,
  };
}
