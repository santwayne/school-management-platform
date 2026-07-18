import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Plus, X, Bus, Gauge, Clock, Wifi, Copy, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiRequest } from '../api';

const DEFAULT_CENTER = [43.6532, -79.3832]; // matches the reference GPS adapter's simulated area
const STALE_MS = 5 * 60 * 1000; // no ping in 5 min = considered idle, not "reporting"

const GPS_VENDORS = [
  { value: 'generic_poll', label: 'Demo / Reference (simulated, no setup needed)' },
  { value: 'generic_rest', label: 'REST API vendor (polled — enter API details after registering)' },
  { value: 'traxroot', label: 'Traxroot (push — vendor sends to your webhook)' },
];

function timeAgo(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))} sec ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)} min ago`;
  return new Date(iso).toLocaleString();
}

function Th({ children, className = '' }) {
  return <th className={`text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

function StatCard({ label, value, icon: Icon, tone }) {
  const toneCls = tone === 'warn' ? 'bg-terracotta/10 text-terracotta-deep' : tone === 'ok' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-cream-deep/60 text-ink-soft';
  return (
    <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-ink-soft">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${toneCls}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="font-display text-2xl text-ink">{value}</div>
    </div>
  );
}

function StatusPill({ reporting }) {
  const cls = reporting ? 'bg-emerald-500/10 text-emerald-700' : 'bg-cream-deep/70 text-ink-soft';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{reporting ? 'Reporting' : 'Idle'}</span>;
}

export default function AdminTransport() {
  const [buses, setBuses] = useState([]);
  const [locations, setLocations] = useState({});
  const [selected, setSelected] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadBuses = async () => {
    try {
      const data = await apiRequest('/api/transport/buses');
      setBuses(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadLocations = async (busList) => {
    const results = {};
    for (const bus of busList) {
      try {
        results[bus.id] = await apiRequest(`/api/transport/buses/${bus.id}/location`);
      } catch (err) {
        // one bus failing to report shouldn't break the whole page
      }
    }
    setLocations(results);
  };

  useEffect(() => {
    loadBuses();
  }, []);

  useEffect(() => {
    if (buses.length === 0) return;
    loadLocations(buses);
    const interval = setInterval(() => loadLocations(buses), 15000);
    return () => clearInterval(interval);
  }, [buses]);

  const isReporting = (busId) => {
    const ts = locations[busId]?.latest?.recorded_at;
    return ts ? Date.now() - new Date(ts).getTime() < STALE_MS : false;
  };

  const stats = useMemo(() => {
    const total = buses.length;
    const reporting = buses.filter((b) => isReporting(b.id)).length;
    const speeds = buses.map((b) => locations[b.id]?.latest?.speed_kmh).filter((s) => s != null);
    const avgSpeed = speeds.length ? Math.round(speeds.reduce((a, b) => a + Number(b), 0) / speeds.length) : 0;
    return { total, reporting, idle: total - reporting, avgSpeed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buses, locations]);

  if (loading) return <p className="text-sm text-ink-soft">Loading buses…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-ink">Transport</h1>
          <p className="text-sm text-ink-soft mt-1">Fleet health and live location for today's routes.</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition"
        >
          <Plus className="w-4 h-4" /> Register bus
        </button>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total buses" value={String(stats.total)} icon={Bus} />
        <StatCard label="Reporting now" value={String(stats.reporting)} icon={Clock} tone="ok" />
        <StatCard label="Idle / no signal" value={String(stats.idle)} icon={Clock} tone={stats.idle > 0 ? 'warn' : undefined} />
        <StatCard label="Avg speed (reporting)" value={`${stats.avgSpeed} km/h`} icon={Gauge} />
      </div>

      {buses.length === 0 ? (
        <p className="text-sm text-ink-soft">No buses registered yet.</p>
      ) : (
        <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Bus</Th>
                <Th>Route</Th>
                <Th>Driver</Th>
                <Th>Status</Th>
                <Th>Last GPS ping</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-deep/60">
              {buses.map((b) => (
                <tr key={b.id} onClick={() => setSelected(b)} className="hover:bg-cream-deep/20 cursor-pointer">
                  <Td className="font-medium">
                    {b.vehicle_number || `Bus #${b.id}`}
                  </Td>
                  <Td className="text-ink-soft">{b.route_name || '—'}</Td>
                  <Td>
                    <div>{b.driver_name || '—'}</div>
                    <div className="text-xs text-ink-soft">{b.driver_phone || ''}</div>
                  </Td>
                  <Td><StatusPill reporting={isReporting(b.id)} /></Td>
                  <Td className="text-ink-soft whitespace-nowrap">{timeAgo(locations[b.id]?.latest?.recorded_at)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <BusPanel bus={selected} location={locations[selected.id]} onClose={() => setSelected(null)} onUpdated={loadBuses} />}

      {addOpen && (
        <RegisterBusModal
          onClose={() => setAddOpen(false)}
          onSave={async (form) => {
            setError('');
            try {
              await apiRequest('/api/transport/buses', { method: 'POST', body: form });
              setAddOpen(false);
              loadBuses();
            } catch (err) {
              setError(err.message);
            }
          }}
        />
      )}
    </div>
  );
}

function BusPanel({ bus, location, onClose, onUpdated }) {
  const latest = location?.latest;
  const trail = location?.trail || [];
  const center = latest ? [latest.latitude, latest.longitude] : DEFAULT_CENTER;
  const trailPositions = trail.map((t) => [t.latitude, t.longitude]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" />
      <aside className="relative bg-cream w-full max-w-md h-full shadow-2xl border-l border-cream-deep flex flex-col overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-cream-deep/70 flex items-start justify-between">
          <div>
            <h3 className="font-display text-xl text-ink">{bus.vehicle_number || `Bus #${bus.id}`}</h3>
            <p className="text-sm text-ink-soft">{bus.route_name || 'No route set'}</p>
            <p className="text-xs text-ink-soft mt-0.5">{bus.gps_vendor}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-cream-deep/60 text-ink-soft">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">Today's movement trail</div>
          <div className="rounded-2xl border border-cream-deep overflow-hidden" style={{ height: 224 }}>
            {latest ? (
              <MapContainer center={center} zoom={14} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                <Marker position={center} />
                {trailPositions.length > 1 && <Polyline positions={trailPositions} />}
              </MapContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-ink-soft bg-cream-deep/30">No location reported yet</div>
            )}
          </div>
        </div>

        <div className="px-5 pb-5 grid grid-cols-2 gap-3">
          <Mini label="Current speed" value={latest?.speed_kmh != null ? `${latest.speed_kmh} km/h` : '—'} icon={Gauge} />
          <Mini label="Last update" value={timeAgo(latest?.recorded_at)} icon={Clock} />
        </div>

        <div className="px-5 pb-6">
          <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">Driver</div>
          <div className="rounded-xl border border-cream-deep bg-white p-3 text-sm">
            <div className="font-medium">{bus.driver_name || '—'}</div>
            <div className="text-xs text-ink-soft mt-0.5">{bus.driver_phone || '—'}</div>
          </div>
        </div>

        <ConnectGpsSection bus={bus} onUpdated={onUpdated} />
      </aside>
    </div>
  );
}

function ConnectGpsSection({ bus, onUpdated }) {
  const isPush = bus.gps_vendor === 'traxroot';
  const isDemo = bus.gps_vendor === 'generic_poll';
  const [baseUrl, setBaseUrl] = useState(bus.vendor_api_base_url || '');
  const [apiKey, setApiKey] = useState('');
  const [latPath, setLatPath] = useState(bus.vendor_lat_path || 'lat');
  const [lngPath, setLngPath] = useState(bus.vendor_lng_path || 'lng');
  const [speedPath, setSpeedPath] = useState(bus.vendor_speed_path || '');
  const [tsPath, setTsPath] = useState(bus.vendor_timestamp_path || '');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const webhookUrl = `${window.location.origin.includes('localhost') ? 'http://localhost:5000' : ''}/api/transport/webhook/${bus.gps_vendor}?token=${bus.webhook_token}`;

  const copyWebhook = () => {
    navigator.clipboard?.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await apiRequest(`/api/transport/buses/${bus.id}/connection`, {
        method: 'PUT',
        body: {
          gps_vendor: bus.gps_vendor,
          vendor_api_base_url: baseUrl || null,
          vendor_api_key: apiKey || undefined,
          vendor_lat_path: latPath,
          vendor_lng_path: lngPath,
          vendor_speed_path: speedPath || null,
          vendor_timestamp_path: tsPath || null,
        },
      });
      setApiKey('');
      onUpdated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const res = await apiRequest(`/api/transport/buses/${bus.id}/test-connection`, { method: 'POST', body: {} });
      setTestResult({ ok: true, location: res.location });
    } catch (err) {
      setTestResult({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="px-5 pb-6 border-t border-cream-deep/70 pt-5">
      <div className="text-xs uppercase tracking-wider text-ink-soft mb-2 flex items-center gap-1.5">
        <Wifi className="w-3.5 h-3.5" /> Connect GPS
      </div>

      {bus.last_poll_status && (
        <div className={`mb-3 text-xs rounded-lg px-3 py-2 flex items-center gap-1.5 ${bus.last_poll_status === 'ok' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-destructive/10 border border-destructive/20 text-destructive'}`}>
          {bus.last_poll_status === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {bus.last_poll_status === 'ok' ? `Last connected ${timeAgo(bus.last_poll_at)}` : `Last error: ${bus.last_poll_error || 'unknown'}`}
        </div>
      )}

      {isDemo && (
        <p className="text-sm text-ink-soft">This bus uses the simulated demo feed — nothing to configure.</p>
      )}

      {isPush && (
        <div className="space-y-2">
          <p className="text-sm text-ink-soft">Give this URL and token to your GPS vendor so they can push locations here:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-cream-deep/40 rounded-lg px-3 py-2 break-all">{webhookUrl}</code>
            <button onClick={copyWebhook} className="p-2 rounded-lg border border-cream-deep hover:bg-cream-deep/40 shrink-0">
              {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-ink-soft" />}
            </button>
          </div>
        </div>
      )}

      {!isDemo && !isPush && (
        <div className="space-y-3">
          {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs px-3 py-2">{error}</div>}
          <Field label="Vendor API URL (use {device_id} as a placeholder)">
            <Input value={baseUrl} onChange={setBaseUrl} placeholder="https://api.vendor.com/v1/devices/{device_id}/location" />
          </Field>
          <Field label="API key">
            <Input value={apiKey} onChange={setApiKey} placeholder={bus.vendor_api_key ? '•••••••• (saved — leave blank to keep)' : 'vendor API key'} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude field path"><Input value={latPath} onChange={setLatPath} placeholder="lat" /></Field>
            <Field label="Longitude field path"><Input value={lngPath} onChange={setLngPath} placeholder="lng" /></Field>
            <Field label="Speed field path (optional)"><Input value={speedPath} onChange={setSpeedPath} placeholder="speed" /></Field>
            <Field label="Timestamp field path (optional)"><Input value={tsPath} onChange={setTsPath} placeholder="timestamp" /></Field>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="flex-1 text-sm font-medium px-3 py-2 rounded-lg bg-terracotta text-white hover:bg-terracotta-deep disabled:opacity-50">
              {saving ? 'Saving…' : 'Save connection'}
            </button>
            <button onClick={testConnection} disabled={testing} className="text-sm font-medium px-3 py-2 rounded-lg border border-cream-deep text-ink hover:bg-cream-deep/40 disabled:opacity-50">
              {testing ? 'Testing…' : 'Test now'}
            </button>
          </div>
          {testResult && (
            <div className={`text-xs rounded-lg px-3 py-2 ${testResult.ok ? 'bg-emerald-500/10 text-emerald-700' : 'bg-destructive/10 border border-destructive/20 text-destructive'}`}>
              {testResult.ok
                ? `Connected — got lat ${testResult.location.latitude}, lng ${testResult.location.longitude}`
                : `Failed: ${testResult.message}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, icon: Icon }) {
  return (
    <div className="rounded-xl bg-white border border-cream-deep p-3">
      <div className="flex items-center gap-1.5 text-xs text-ink-soft">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-sm font-medium text-ink mt-1">{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Input({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
    />
  );
}

function RegisterBusModal({ onClose, onSave }) {
  const [routeName, setRouteName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [gpsVendor, setGpsVendor] = useState('generic_poll');
  const [vendorDeviceId, setVendorDeviceId] = useState('');
  const valid = vehicleNumber.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-cream rounded-2xl border border-cream-deep w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-cream-deep/70">
          <h3 className="font-display text-lg text-ink inline-flex items-center gap-2">
            <Bus className="w-5 h-5 text-terracotta" /> Register bus
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-cream-deep/60 text-ink-soft">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          <Field label="Vehicle number">
            <Input value={vehicleNumber} onChange={setVehicleNumber} placeholder="RJ 14 XX 0000" />
          </Field>
          <Field label="Route">
            <Input value={routeName} onChange={setRouteName} placeholder="Route 5 — Bani Park" />
          </Field>
          <Field label="Driver name">
            <Input value={driverName} onChange={setDriverName} placeholder="Full name" />
          </Field>
          <Field label="Driver phone">
            <Input value={driverPhone} onChange={setDriverPhone} placeholder="+91 …" />
          </Field>
          <Field label="GPS vendor">
            <select
              value={gpsVendor}
              onChange={(e) => setGpsVendor(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
            >
              {GPS_VENDORS.map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Vendor device ID (for push vendors)">
            <Input value={vendorDeviceId} onChange={setVendorDeviceId} placeholder="optional" />
          </Field>
        </div>
        <p className="mx-5 mb-3 text-xs text-ink-soft rounded-lg bg-cream-deep/50 px-3 py-2">
          "Demo / Reference" moves on its own with no setup. For a real vendor, register the bus first, then open it
          and use "Connect GPS" to add the vendor's API details (or webhook, for push vendors).
        </p>
        <div className="px-5 py-4 border-t border-cream-deep/70 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg text-ink-soft hover:bg-cream-deep/60">
            Cancel
          </button>
          <button
            disabled={!valid}
            onClick={() =>
              onSave({
                route_name: routeName.trim() || undefined,
                vehicle_number: vehicleNumber.trim(),
                driver_name: driverName.trim() || undefined,
                driver_phone: driverPhone.trim() || undefined,
                gps_vendor: gpsVendor,
                vendor_device_id: vendorDeviceId.trim() || undefined,
              })
            }
            className="text-sm font-medium px-4 py-2 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Register
          </button>
        </div>
      </div>
    </div>
  );
}
