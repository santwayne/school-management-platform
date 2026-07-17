import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../api';

export default function FeeCollectorsCard() {
  const [collectors, setCollectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setCollectors(await apiRequest('/api/fee-collectors'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!name.trim() || !number.trim()) return;
    setError('');
    try {
      await apiRequest('/api/fee-collectors', { method: 'POST', body: { name: name.trim(), whatsapp_number: number.trim() } });
      setName('');
      setNumber('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (id) => {
    try {
      await apiRequest(`/api/fee-collectors/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <p className="text-xs text-ink-soft mb-3">Field staff who collect cash and photograph slips on WhatsApp. Only registered numbers are accepted.</p>
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive mb-3">{error}</div>}
      {loading ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : (
        <div className="space-y-2 mb-3">
          {collectors.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-2.5 rounded-lg bg-cream-deep/30">
              <div>
                <div className="text-sm font-medium text-ink">{c.name}</div>
                <div className="text-xs text-ink-soft">{c.whatsapp_number} · ₹{Number(c.collected_last_30_days).toLocaleString('en-IN')} collected (30d)</div>
              </div>
              <button onClick={() => remove(c.id)} className="text-ink-soft hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {collectors.length === 0 && <p className="text-sm text-ink-soft">No fee collectors added yet.</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1 min-w-[120px] px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm" />
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+91XXXXXXXXXX" className="flex-1 min-w-[140px] px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm" />
        <button onClick={add} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition">
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
    </div>
  );
}
