import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, CalendarDays, Settings2 } from 'lucide-react';
import { apiRequest } from '../../api';
import { PageTitle, ErrorBanner, KANBAN_STAGES, STAGE_LABELS, SourceChip, timeAgo } from './admissionsUi';

const REQUIRED_FIELDS = ['parent_name', 'phone'];

function NewEnquiryModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ phone: '', parent_name: '', child_name: '', applying_class: '', locality: '', needs_transport: false, source: 'walk_in', notes: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/admissions/enquiries', { method: 'POST', body: form });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl border border-cream-deep/70 p-6 w-full max-w-md space-y-4">
        <h2 className="font-display text-xl text-ink">New enquiry</h2>
        <ErrorBanner message={error} />
        <label className="block text-sm">
          <span className="text-ink-soft">Parent's phone</span>
          <input required value={form.phone} onChange={set('phone')} placeholder="98765 43210" inputMode="tel" className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
        </label>
        <label className="block text-sm">
          <span className="text-ink-soft">Parent's name</span>
          <input value={form.parent_name} onChange={set('parent_name')} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
        </label>
        <label className="block text-sm">
          <span className="text-ink-soft">Child's name</span>
          <input value={form.child_name} onChange={set('child_name')} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-ink-soft">Applying for class</span>
            <input value={form.applying_class} onChange={set('applying_class')} placeholder="Class 3" className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
          </label>
          <label className="block text-sm">
            <span className="text-ink-soft">Locality</span>
            <input value={form.locality} onChange={set('locality')} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.needs_transport} onChange={set('needs_transport')} className="w-4 h-4 accent-terracotta" />
          Needs school transport
        </label>
        <label className="block text-sm">
          <span className="text-ink-soft">How did they reach us?</span>
          <select value={form.source} onChange={set('source')} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep">
            <option value="walk_in">Walk-in</option>
            <option value="phone">Phone call</option>
            <option value="web_form">Website</option>
          </select>
        </label>
        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-ink-soft hover:text-ink">Cancel</button>
          <button disabled={saving || !form.phone} className="px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
            {saving ? 'Adding…' : 'Add enquiry'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AdmissionsPipeline() {
  const [items, setItems] = useState(null);
  const [counts, setCounts] = useState({});
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ stage: 'active' });
      if (q) params.set('q', q);
      const d = await apiRequest(`/api/admissions/enquiries?${params}`);
      setItems(d.items);
      setCounts(d.counts || {});
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [q]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const admitted = counts.admitted || 0;
  const lost = counts.lost || 0;
  const byStage = KANBAN_STAGES.reduce((acc, s) => {
    acc[s] = (items || []).filter((e) => e.stage === s);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <PageTitle
        title="Admissions"
        subtitle="Every enquiry, from first WhatsApp message to admitted student."
        right={
          <div className="flex items-center gap-2">
            <Link to="/ops/admissions/slots" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cream-deep text-sm text-ink-soft hover:text-ink">
              <CalendarDays className="w-4 h-4" /> Visit slots
            </Link>
            <Link to="/ops/admissions/settings" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cream-deep text-sm text-ink-soft hover:text-ink">
              <Settings2 className="w-4 h-4" /> Settings
            </Link>
            <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep">
              <Plus className="w-4 h-4" /> New enquiry
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone…" className="w-full pl-9 pr-3 py-2 rounded-lg border border-cream-deep text-sm" />
        </div>
        <span className="text-xs text-ink-soft">{admitted} admitted · {lost} lost (last 30 days shown by default)</span>
      </div>

      <ErrorBanner message={error} />
      {!items && !error && <div className="text-sm text-ink-soft">Loading…</div>}

      {items && (
        <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
          {KANBAN_STAGES.map((stage) => (
            <div key={stage} className="w-64 shrink-0">
              <div className="flex items-center justify-between px-1 mb-2">
                <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">{STAGE_LABELS[stage]}</h3>
                <span className="text-xs text-ink-soft">{byStage[stage].length}</span>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {byStage[stage].length === 0 && <div className="text-xs text-ink-soft/70 px-2 py-3 text-center border border-dashed border-cream-deep rounded-xl">Empty</div>}
                {byStage[stage].map((e) => (
                  <Link
                    key={e.id}
                    to={`/ops/admissions/${e.id}`}
                    className="block bg-white rounded-xl border border-cream-deep/70 px-3 py-2.5 hover:border-terracotta/50 hover:shadow-sm transition"
                  >
                    <div className="text-sm font-medium text-ink truncate">{e.child_name || e.parent_name || 'Unnamed'}</div>
                    <div className="text-xs text-ink-soft truncate">{e.applying_class_label || e.applying_class_text || 'Class TBD'} · {e.locality || 'no area'}</div>
                    <div className="flex items-center justify-between mt-1.5">
                      <SourceChip source={e.source} />
                      <span className="text-[11px] text-ink-soft">{timeAgo(e.last_inbound_at || e.updated_at)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && <NewEnquiryModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
    </div>
  );
}
