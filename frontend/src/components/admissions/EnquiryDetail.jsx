import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Send, Pause, Play, UserCheck2 } from 'lucide-react';
import { apiRequest } from '../../api';
import { ErrorBanner, Notice, STAGE_LABELS, STAGES, SourceChip, formatDateTime, formatDate } from './admissionsUi';

function AdmitModal({ enquiry, classes, onClose, onAdmitted }) {
  const [classId, setClassId] = useState('');
  const [childName, setChildName] = useState(enquiry.child_name || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest(`/api/admissions/enquiries/${enquiry.id}/convert`, {
        method: 'POST',
        body: { class_id: classId || undefined, child_name: childName },
      });
      onAdmitted();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl border border-cream-deep/70 p-6 w-full max-w-md space-y-4">
        <h2 className="font-display text-xl text-ink">Admit {enquiry.child_name || 'this child'}</h2>
        <p className="text-sm text-ink-soft">Creates a parent and student record, respecting section seat limits.</p>
        <ErrorBanner message={error} />
        <label className="block text-sm">
          <span className="text-ink-soft">Child's full name</span>
          <input required value={childName} onChange={(e) => setChildName(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" />
        </label>
        <label className="block text-sm">
          <span className="text-ink-soft">Class &amp; section</span>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep">
            <option value="">Auto (from "{enquiry.applying_class_label || enquiry.applying_class_text || 'applying class'}")</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.section ? ` ${c.section}` : ''}</option>
            ))}
          </select>
        </label>
        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-ink-soft hover:text-ink">Cancel</button>
          <button disabled={saving} className="px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">
            {saving ? 'Admitting…' : 'Admit'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function EnquiryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [classes, setClasses] = useState([]);
  const [showAdmit, setShowAdmit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiRequest(`/api/admissions/enquiries/${id}`);
      setData(d);
      setFields({
        parent_name: d.parent_name || '', child_name: d.child_name || '', locality: d.locality || '',
        applying_class: d.applying_class_label || d.applying_class_text || '', needs_transport: !!d.needs_transport,
      });
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiRequest('/api/academics/classes').then(setClasses).catch(() => {});
  }, []);

  const sendReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    setError('');
    try {
      const r = await apiRequest(`/api/admissions/enquiries/${id}/reply`, { method: 'POST', body: { text: reply.trim() } });
      setReply('');
      setNotice(r.delivered ? 'Sent.' : 'Saved, but WhatsApp delivery may have failed.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const pauseAi = async (hours) => {
    setBusy(true);
    try {
      await apiRequest(`/api/admissions/enquiries/${id}/pause`, { method: 'POST', body: { hours } });
      setNotice(hours ? `AI paused for ${hours}h — you're driving this conversation now.` : 'AI resumed.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveFields = async () => {
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/admissions/enquiries/${id}`, { method: 'PATCH', body: fields });
      setEditing(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const setStage = async (stage) => {
    if (stage === 'admitted') { setShowAdmit(true); return; }
    if (stage === 'lost') {
      const reason = window.prompt('Why is this lead lost? (optional)') || '';
      setBusy(true);
      try {
        await apiRequest(`/api/admissions/enquiries/${id}`, { method: 'PATCH', body: { stage, lost_reason: reason || undefined } });
        load();
      } catch (err) { setError(err.message); } finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/api/admissions/enquiries/${id}`, { method: 'PATCH', body: { stage } });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const markVisit = async (visitId, status) => {
    setBusy(true);
    try {
      await apiRequest(`/api/admissions/visits/${visitId}/outcome`, { method: 'POST', body: { status } });
      setNotice(status === 'attended' ? 'Marked as attended.' : 'Visit updated.');
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (!data && !error) return <div className="text-sm text-ink-soft">Loading…</div>;
  if (error && !data) return <ErrorBanner message={error} />;

  const paused = data.ai_paused_until && new Date(data.ai_paused_until) > new Date();
  const openVisit = (data.visits || []).find((v) => v.status === 'booked');

  return (
    <div className="space-y-5">
      <Link to="/ops/admissions" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="w-4 h-4" /> All enquiries
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink">{data.child_name || data.parent_name || 'Unnamed enquiry'}</h1>
          <div className="flex items-center gap-2 mt-1 text-sm text-ink-soft">
            <SourceChip source={data.source} /> · {data.phone}
            {data.opted_out && <span className="text-destructive font-medium">· Opted out of WhatsApp</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={data.stage} onChange={(e) => setStage(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-cream-deep text-sm">
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
          {data.stage !== 'admitted' && (
            <button onClick={() => setShowAdmit(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep">
              <UserCheck2 className="w-4 h-4" /> Admit
            </button>
          )}
        </div>
      </div>

      <ErrorBanner message={error} />
      <Notice message={notice} />

      {openVisit && (
        <div className="bg-white rounded-2xl border border-cream-deep/70 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-ink">Campus visit booked for <strong>{formatDateTime(openVisit.slot_start)}</strong></span>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => markVisit(openVisit.id, 'attended')} className="px-3 py-1.5 rounded-lg bg-ink text-cream text-sm hover:opacity-90 disabled:opacity-50">Attended</button>
            <button disabled={busy} onClick={() => markVisit(openVisit.id, 'no_show')} className="px-3 py-1.5 rounded-lg border border-cream-deep text-sm text-ink-soft hover:text-ink disabled:opacity-50">No-show</button>
            <button disabled={busy} onClick={() => markVisit(openVisit.id, 'cancelled')} className="px-3 py-1.5 rounded-lg text-sm text-ink-soft hover:text-destructive disabled:opacity-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-cream-deep/70 flex flex-col h-[480px]">
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {data.messages.length === 0 && <p className="text-sm text-ink-soft text-center py-8">No messages yet.</p>}
              {data.messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-3.5 py-2 text-sm ${m.direction === 'out' ? 'bg-terracotta text-white' : 'bg-cream-deep/50 text-ink'}`}>
                    <p className="whitespace-pre-line">{m.body}</p>
                    <div className={`text-[10px] mt-1 ${m.direction === 'out' ? 'text-white/70' : 'text-ink-soft'}`}>
                      {formatDateTime(m.created_at)}{m.sent_by === 'staff' ? ' · you' : m.sent_by === 'ai' ? ' · AI' : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={sendReply} className="border-t border-cream-deep/60 p-3 flex gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                disabled={!data.can_reply}
                placeholder={data.can_reply ? 'Type a reply…' : "Outside WhatsApp's 24h reply window — call them instead"}
                className="flex-1 px-3 py-2 rounded-lg border border-cream-deep text-sm disabled:bg-cream-deep/30"
              />
              <button disabled={sending || !data.can_reply || !reply.trim()} className="px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50 inline-flex items-center gap-1.5">
                <Send className="w-4 h-4" /> Send
              </button>
            </form>
          </div>
          <button
            disabled={busy}
            onClick={() => pauseAi(paused ? 0 : 24)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-deep text-sm text-ink-soft hover:text-ink disabled:opacity-50"
          >
            {paused ? <><Play className="w-3.5 h-3.5" /> Resume AI replies</> : <><Pause className="w-3.5 h-3.5" /> Pause AI for 24h (you'll reply by hand)</>}
          </button>
          {paused && <span className="ml-2 text-xs text-ink-soft">Paused until {formatDateTime(data.ai_paused_until)}</span>}
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-cream-deep/70 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg text-ink">Details</h2>
              {!editing && <button onClick={() => setEditing(true)} className="text-xs text-terracotta-deep hover:underline">Edit</button>}
            </div>
            {!editing ? (
              <dl className="text-sm space-y-2">
                <div className="flex justify-between"><dt className="text-ink-soft">Parent</dt><dd className="text-ink">{data.parent_name || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">Applying for</dt><dd className="text-ink">{data.applying_class_label || data.applying_class_text || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">Locality</dt><dd className="text-ink">{data.locality || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">Transport</dt><dd className="text-ink">{data.needs_transport ? 'Needed' : 'Not needed'}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">First contact</dt><dd className="text-ink">{formatDate(data.created_at)}</dd></div>
              </dl>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm"><span className="text-ink-soft">Parent</span>
                  <input value={fields.parent_name} onChange={(e) => setFields({ ...fields, parent_name: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" /></label>
                <label className="block text-sm"><span className="text-ink-soft">Child</span>
                  <input value={fields.child_name} onChange={(e) => setFields({ ...fields, child_name: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" /></label>
                <label className="block text-sm"><span className="text-ink-soft">Applying for</span>
                  <input value={fields.applying_class} onChange={(e) => setFields({ ...fields, applying_class: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" /></label>
                <label className="block text-sm"><span className="text-ink-soft">Locality</span>
                  <input value={fields.locality} onChange={(e) => setFields({ ...fields, locality: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-cream-deep" /></label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={fields.needs_transport} onChange={(e) => setFields({ ...fields, needs_transport: e.target.checked })} className="w-4 h-4 accent-terracotta" /> Needs transport
                </label>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-sm text-ink-soft">Cancel</button>
                  <button disabled={busy} onClick={saveFields} className="px-3 py-1.5 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50">Save</button>
                </div>
              </div>
            )}
          </div>

          {data.matching_classes?.length > 0 && (
            <div className="bg-white rounded-2xl border border-cream-deep/70 p-5">
              <h2 className="font-display text-lg text-ink mb-2">Matching sections</h2>
              <ul className="text-sm text-ink-soft space-y-1">
                {data.matching_classes.map((c) => <li key={c.id}>{c.name} {c.section}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      {showAdmit && (
        <AdmitModal
          enquiry={data}
          classes={classes}
          onClose={() => setShowAdmit(false)}
          onAdmitted={() => { setShowAdmit(false); navigate('/ops/admissions'); }}
        />
      )}
    </div>
  );
}
