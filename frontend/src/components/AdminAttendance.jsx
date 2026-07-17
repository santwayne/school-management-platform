import React, { Fragment, useEffect, useState } from 'react';
import { Plus, X, Fingerprint, ChevronDown, ChevronRight, AlertTriangle, Pencil } from 'lucide-react';
import { apiRequest } from '../api';

const VENDOR_LABELS = { zkteco: 'ZKTeco', csv_import: 'Generic CSV' };
const STAFF_STATUSES = ['present', 'absent', 'half_day', 'manual_override'];
const STATUS_LABELS = { present: 'Present', absent: 'Absent', half_day: 'Half-day', manual_override: 'Manual override' };

function Th({ children, className = '' }) {
  return <th className={`text-left font-medium text-xs uppercase tracking-wider text-ink-soft px-4 py-3 bg-cream-deep/40 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

function StatusPill({ status }) {
  const cls =
    status === 'present'
      ? 'bg-emerald-500/10 text-emerald-700'
      : status === 'half_day'
        ? 'bg-sky-500/10 text-sky-700'
        : status === 'manual_override'
          ? 'bg-amber-500/15 text-amber-700'
          : 'bg-terracotta/15 text-terracotta-deep';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{STATUS_LABELS[status]}</span>;
}

export default function AdminAttendance() {
  const [devices, setDevices] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [mappings, setMappings] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [overrideId, setOverrideId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    try {
      const [d, t, s] = await Promise.all([
        apiRequest('/api/biometric/devices'),
        apiRequest('/api/academics/teachers'),
        apiRequest('/api/biometric/attendance/today'),
      ]);
      setDevices(d);
      setTeachers(t);
      setStaff(s);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const toggleExpand = async (deviceId) => {
    if (expanded === deviceId) {
      setExpanded(null);
      return;
    }
    setExpanded(deviceId);
    if (!mappings[deviceId]) {
      try {
        const rows = await apiRequest(`/api/biometric/devices/${deviceId}/mappings`);
        setMappings((m) => ({ ...m, [deviceId]: rows }));
      } catch (err) {
        setError(err.message);
      }
    }
  };

  const addMapping = async (deviceId, deviceInternalId, teacherId) => {
    setError('');
    try {
      await apiRequest(`/api/biometric/devices/${deviceId}/map-teacher`, {
        method: 'POST',
        body: { teacher_id: teacherId, device_internal_id: deviceInternalId },
      });
      const rows = await apiRequest(`/api/biometric/devices/${deviceId}/mappings`);
      setMappings((m) => ({ ...m, [deviceId]: rows }));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCsvUpload = (deviceId, e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const lines = evt.target.result.split('\n').map((l) => l.trim()).filter(Boolean);
      const headers = lines[0].split(',').map((h) => h.trim());
      const rows = lines.slice(1).map((line) => {
        const values = line.split(',');
        const row = {};
        headers.forEach((h, i) => (row[h] = values[i]?.trim()));
        return row;
      });
      try {
        const res = await apiRequest('/api/biometric/csv-import', { method: 'POST', body: { device_id: deviceId, rows } });
        setError('');
        setMessage(`Imported ${res.inserted_count} punches (${res.skipped_count} skipped — unmapped IDs).`);
        loadAll();
        setTimeout(() => setMessage(''), 5000);
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const correct = async (teacherId, status) => {
    setError('');
    try {
      await apiRequest(`/api/biometric/attendance/by-teacher/${teacherId}`, { method: 'PATCH', body: { status } });
      setOverrideId(null);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <p className="text-sm text-ink-soft">Loading attendance…</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-ink">Attendance</h1>
        <p className="text-sm text-ink-soft mt-1">Biometric devices and today's staff punches.</p>
      </div>

      {message && <div className="rounded-xl bg-joy-leaf/25 border border-joy-leaf/40 px-4 py-3 text-sm text-ink">{message}</div>}
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl text-ink">Devices</h2>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition"
          >
            <Plus className="w-4 h-4" /> Register device
          </button>
        </div>
        <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th></Th>
                <Th>Device</Th>
                <Th>Vendor</Th>
                <Th>Webhook / CSV import</Th>
                <Th>Mapped IDs</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-deep/60">
              {devices.map((d) => {
                const isOpen = expanded === d.id;
                const rows = mappings[d.id];
                return (
                  <Fragment key={d.id}>
                    <tr onClick={() => toggleExpand(d.id)} className="hover:bg-cream-deep/20 cursor-pointer">
                      <Td className="w-8 text-ink-soft">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</Td>
                      <Td>
                        <div className="font-medium">{d.label || '—'}</div>
                        {d.device_serial && <div className="text-xs text-ink-soft">{d.device_serial}</div>}
                      </Td>
                      <Td className="text-ink-soft">{VENDOR_LABELS[d.vendor] || d.vendor}</Td>
                      <Td className="text-ink-soft" onClick={(e) => e.stopPropagation()}>
                        {d.vendor === 'csv_import' ? (
                          <input type="file" accept=".csv" onChange={(e) => handleCsvUpload(d.id, e)} className="text-xs" />
                        ) : (
                          <span className="font-mono text-xs">
                            /api/biometric/webhook/{d.vendor}?token={d.webhook_token}
                          </span>
                        )}
                      </Td>
                      <Td className="text-ink-soft">{rows ? rows.length : '…'}</Td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-cream-deep/20">
                        <td colSpan={5} className="p-5">
                          <div className="text-xs uppercase tracking-wider text-ink-soft mb-3">Employee ID mapping</div>
                          {!rows ? (
                            <p className="text-sm text-ink-soft">Loading…</p>
                          ) : (
                            <div className="space-y-2">
                              {rows.map((m) => (
                                <div key={m.device_internal_id} className="flex items-center gap-3 rounded-lg bg-white border border-cream-deep px-3 py-2">
                                  <div className="text-xs font-mono px-2 py-0.5 rounded bg-cream-deep/60 text-ink-soft">{m.device_internal_id}</div>
                                  <select
                                    value={m.teacher_id}
                                    onChange={(e) => addMapping(d.id, m.device_internal_id, e.target.value)}
                                    className="flex-1 text-sm rounded-md bg-white border border-cream-deep px-2 py-1 focus:outline-none focus:ring-2 focus:ring-terracotta/40"
                                  >
                                    {teachers.map((t) => (
                                      <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                  </select>
                                </div>
                              ))}
                              <AddMappingRow teachers={teachers} onAdd={(internalId, teacherId) => addMapping(d.id, internalId, teacherId)} />
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="font-display text-xl text-ink">Today's staff attendance</h2>
            <p className="text-sm text-ink-soft">Auto-pulled from biometric devices. Override where needed.</p>
          </div>
          <div className="text-xs text-ink-soft">
            {staff.filter((s) => s.status === 'present').length} present ·{' '}
            {staff.filter((s) => s.status === 'half_day').length} half-day ·{' '}
            {staff.filter((s) => s.status === 'absent').length} absent
          </div>
        </div>
        <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Teacher</Th>
                <Th>Punch in</Th>
                <Th>Punch out</Th>
                <Th>Status</Th>
                <Th>Source</Th>
                <Th className="text-right">Override</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-deep/60">
              {staff.map((r) => {
                const isEditing = overrideId === r.teacher_id;
                return (
                  <tr key={r.teacher_id} className="hover:bg-cream-deep/20 align-top">
                    <Td className="font-medium">{r.teacher_name}</Td>
                    <Td className="text-ink-soft">{r.first_punch ? new Date(r.first_punch).toLocaleTimeString() : '—'}</Td>
                    <Td className="text-ink-soft">{r.last_punch ? new Date(r.last_punch).toLocaleTimeString() : '—'}</Td>
                    <Td>
                      {isEditing ? (
                        <select
                          defaultValue={r.status}
                          onChange={(e) => correct(r.teacher_id, e.target.value)}
                          className="text-sm rounded-md bg-white border border-cream-deep px-2 py-1 focus:outline-none focus:ring-2 focus:ring-terracotta/40"
                        >
                          {STAFF_STATUSES.map((s) => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      ) : (
                        <StatusPill status={r.status} />
                      )}
                    </Td>
                    <Td className="text-ink-soft">{r.corrected_by ? 'Manual override' : 'Biometric'}</Td>
                    <Td className="text-right">
                      {!isEditing && (
                        <button onClick={() => setOverrideId(r.teacher_id)} className="p-1.5 rounded-md text-ink-soft hover:text-terracotta-deep hover:bg-terracotta/10">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {addOpen && (
        <RegisterDeviceModal
          onClose={() => setAddOpen(false)}
          onSave={async (form) => {
            setError('');
            try {
              await apiRequest('/api/biometric/devices', { method: 'POST', body: form });
              setAddOpen(false);
              loadAll();
            } catch (err) {
              setError(err.message);
            }
          }}
        />
      )}
    </div>
  );
}

function AddMappingRow({ teachers, onAdd }) {
  const [internalId, setInternalId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const valid = internalId.trim() && teacherId;
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white border border-dashed border-cream-deep px-3 py-2">
      <input
        value={internalId}
        onChange={(e) => setInternalId(e.target.value)}
        placeholder="Device's internal enrollment ID"
        className="text-xs font-mono px-2 py-1 rounded bg-cream-deep/40 border-0 focus:outline-none focus:ring-2 focus:ring-terracotta/40 w-40"
      />
      <select
        value={teacherId}
        onChange={(e) => setTeacherId(e.target.value)}
        className="flex-1 text-sm rounded-md bg-white border border-cream-deep px-2 py-1 focus:outline-none focus:ring-2 focus:ring-terracotta/40"
      >
        <option value="">Select teacher</option>
        {teachers.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <button
        disabled={!valid}
        onClick={() => {
          onAdd(internalId.trim(), teacherId);
          setInternalId('');
          setTeacherId('');
        }}
        className="text-xs font-medium px-3 py-1.5 rounded-md bg-terracotta text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Map
      </button>
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

function RegisterDeviceModal({ onClose, onSave }) {
  const [label, setLabel] = useState('');
  const [deviceSerial, setDeviceSerial] = useState('');
  const [vendor, setVendor] = useState('zkteco');
  const valid = label.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-cream rounded-2xl border border-cream-deep w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-cream-deep/70">
          <h3 className="font-display text-lg text-ink inline-flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-terracotta" /> Register device
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-cream-deep/60 text-ink-soft">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Device name">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Main Gate Scanner"
              className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
            />
          </Field>
          <Field label="Device serial (optional)">
            <input
              value={deviceSerial}
              onChange={(e) => setDeviceSerial(e.target.value)}
              placeholder="e.g. ZK-4821"
              className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
            />
          </Field>
          <Field label="Vendor">
            <select
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
            >
              <option value="zkteco">ZKTeco</option>
              <option value="csv_import">Generic CSV</option>
            </select>
          </Field>
          <p className="text-xs text-ink-soft rounded-lg bg-cream-deep/50 px-3 py-2">
            {vendor === 'zkteco'
              ? 'Pushes attendance automatically via webhook once the device is on the school network.'
              : "No push support — you'll upload each day's export as a CSV from the devices list."}
          </p>
        </div>
        <div className="px-5 py-4 border-t border-cream-deep/70 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg text-ink-soft hover:bg-cream-deep/60">
            Cancel
          </button>
          <button
            disabled={!valid}
            onClick={() => onSave({ vendor, device_serial: deviceSerial.trim() || undefined, label: label.trim() })}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-terracotta text-primary-foreground hover:bg-terracotta-deep transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Register
          </button>
        </div>
      </div>
    </div>
  );
}
