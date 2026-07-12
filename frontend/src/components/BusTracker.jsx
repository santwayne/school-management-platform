import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { apiRequest } from '../api';

const DEFAULT_CENTER = [43.6532, -79.3832]; // Toronto — matches the reference GPS adapter's simulated area

export default function BusTracker() {
  const [buses, setBuses] = useState([]);
  const [locations, setLocations] = useState({}); // bus_id -> { latest, trail }
  const [form, setForm] = useState({ route_name: '', vehicle_number: '', driver_name: '', driver_phone: '', gps_vendor: 'generic_poll', vendor_device_id: '' });
  const [error, setError] = useState('');

  const loadBuses = async () => {
    try {
      const data = await apiRequest('/api/transport/buses', { method: 'GET' });
      setBuses(data);
    } catch (err) {
      setError('Failed to load buses.');
    }
  };

  const loadLocations = async (busList) => {
    const results = {};
    for (const bus of busList) {
      try {
        results[bus.id] = await apiRequest(`/api/transport/buses/${bus.id}/location`, { method: 'GET' });
      } catch (err) {
        // one bus failing to report shouldn't break the whole map
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
    const interval = setInterval(() => loadLocations(buses), 15000); // poll our own backend, not the vendor directly
    return () => clearInterval(interval);
  }, [buses]);

  const handleAddBus = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiRequest('/api/transport/buses', { method: 'POST', body: form });
      setForm({ route_name: '', vehicle_number: '', driver_name: '', driver_phone: '', gps_vendor: 'generic_poll', vendor_device_id: '' });
      loadBuses();
    } catch (err) {
      setError(err.message);
    }
  };

  const center = Object.values(locations)[0]?.latest
    ? [Object.values(locations)[0].latest.latitude, Object.values(locations)[0].latest.longitude]
    : DEFAULT_CENTER;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">School Bus Tracker</h1>
      {error && <div className="p-3 bg-red-100 text-red-700 text-sm rounded">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleAddBus} className="bg-white p-5 border rounded-lg shadow-sm space-y-3 h-fit">
          <h2 className="text-lg font-semibold text-gray-800">Register Bus</h2>
          <input type="text" placeholder="Route Name" value={form.route_name} onChange={(e) => setForm({ ...form, route_name: e.target.value })} className="w-full p-2 border text-sm rounded" />
          <input type="text" placeholder="Vehicle Number" value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} className="w-full p-2 border text-sm rounded" />
          <input type="text" placeholder="Driver Name" value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} className="w-full p-2 border text-sm rounded" />
          <input type="text" placeholder="Driver Phone" value={form.driver_phone} onChange={(e) => setForm({ ...form, driver_phone: e.target.value })} className="w-full p-2 border text-sm rounded" />
          <select value={form.gps_vendor} onChange={(e) => setForm({ ...form, gps_vendor: e.target.value })} className="w-full p-2 border text-sm rounded bg-white">
            <option value="generic_poll">Demo / Reference (simulated)</option>
            <option value="trackmybus">TrackMyBus (not yet integrated)</option>
            <option value="traxroot">Traxroot (not yet integrated)</option>
          </select>
          <input type="text" placeholder="Vendor Device ID" value={form.vendor_device_id} onChange={(e) => setForm({ ...form, vendor_device_id: e.target.value })} className="w-full p-2 border text-sm rounded" />
          <button type="submit" className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium">Add Bus</button>
          <p className="text-xs text-gray-400">Only "Demo / Reference" actually reports a moving location right now — TrackMyBus/Traxroot need real vendor API credentials before they'll show real positions.</p>
        </form>

        <div className="lg:col-span-2 bg-white border rounded-lg shadow-sm overflow-hidden" style={{ height: 500 }}>
          <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />
            {buses.map((bus) => {
              const loc = locations[bus.id];
              if (!loc?.latest) return null;
              const pos = [loc.latest.latitude, loc.latest.longitude];
              const trailPositions = loc.trail?.map((t) => [t.latitude, t.longitude]) || [];
              return (
                <React.Fragment key={bus.id}>
                  <Marker position={pos}>
                    <Popup>
                      <strong>{bus.route_name || bus.vehicle_number || `Bus #${bus.id}`}</strong>
                      <br />
                      Driver: {bus.driver_name || '—'}
                      <br />
                      Speed: {loc.latest.speed_kmh ?? '—'} km/h
                    </Popup>
                  </Marker>
                  {trailPositions.length > 1 && <Polyline positions={trailPositions} />}
                </React.Fragment>
              );
            })}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
