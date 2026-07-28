import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessagesSquare, Send, Plus, Users, User, AlertCircle, CheckCheck, X } from 'lucide-react';
import { apiRequest } from '../api';

// Threaded, class/individual extension of the existing broadcast system
// (see backend/routes/communications.js) — same `broadcasts` table, just
// grouped by thread_key ('class:<id>' / 'student:<id>') instead of shown as
// a flat log. Mass 'all_parents'/'all_staff' blasts stay on the Communications
// page; this page is specifically for a class or a single student/parent.

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function ThreadIcon({ threadKey }) {
  const isStudent = threadKey?.startsWith('student:');
  const Icon = isStudent ? User : Users;
  return (
    <div className="w-9 h-9 rounded-xl bg-terracotta/10 border border-terracotta/20 flex items-center justify-center shrink-0">
      <Icon className="w-4 h-4 text-terracotta" />
    </div>
  );
}

function NewThreadComposer({ onSent, onClose }) {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [mode, setMode] = useState('class'); // 'class' | 'student'
  const [roster, setRoster] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest('/api/academics/classes').then(setClasses).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    setStudentId('');
    setRoster([]);
    if (mode === 'student' && classId) {
      apiRequest(`/api/academics/class/${classId}/roster`)
        .then((r) => setRoster(r.students || []))
        .catch((err) => setError(err.message));
    }
  }, [classId, mode]);

  const selectedClass = classes.find((c) => String(c.id) === String(classId));
  const selectedStudent = roster.find((s) => String(s.id) === String(studentId));

  const canSend = message.trim() && classId && (mode === 'class' || studentId);

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError('');
    try {
      const audience = mode === 'student' ? `student:${studentId}` : `class:${classId}`;
      const audience_label = mode === 'student'
        ? `${selectedStudent?.name || 'Student'} (${selectedClass?.name || ''})`
        : selectedClass?.name || 'Class';
      const result = await apiRequest('/api/communications/send', {
        method: 'POST',
        body: { audience, audience_label, message: message.trim() },
      });
      onSent(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white border border-cream-deep/70 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">New message</span>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-cream-deep/60 text-ink-soft">
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-destructive/8 border border-destructive/20 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex gap-1 p-1 bg-cream-deep/50 rounded-lg border border-cream-deep w-fit">
        {[{ key: 'class', label: 'Whole class' }, { key: 'student', label: 'One student' }].map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
              mode === m.key ? 'bg-white text-terracotta-deep shadow-sm' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          className="p-2 border border-cream-deep rounded-lg text-sm bg-white text-ink"
        >
          <option value="">Select class</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {mode === 'student' && (
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            disabled={!classId}
            className="p-2 border border-cream-deep rounded-lg text-sm bg-white text-ink disabled:opacity-50"
          >
            <option value="">{classId ? 'Select student' : 'Pick a class first'}</option>
            {roster.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, 1000))}
        rows={3}
        placeholder="Type your message…"
        className="w-full px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-terracotta/30 focus:border-terracotta/50 resize-none transition"
      />

      <button
        onClick={handleSend}
        disabled={!canSend || sending}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Send className="w-3.5 h-3.5" />
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}

export default function AdminMessages() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [threads, setThreads] = useState([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [selectedKey, setSelectedKey] = useState(searchParams.get('thread') || '');
  const [thread, setThread] = useState(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [composing, setComposing] = useState(false);
  const [reply, setReply] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [error, setError] = useState('');

  const loadThreads = async () => {
    setLoadingThreads(true);
    try {
      setThreads(await apiRequest('/api/communications/threads'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingThreads(false);
    }
  };

  const loadThread = async (key) => {
    if (!key) { setThread(null); return; }
    setLoadingThread(true);
    try {
      setThread(await apiRequest(`/api/communications/threads/${encodeURIComponent(key)}`));
    } catch (err) {
      setError(err.message);
      setThread(null);
    } finally {
      setLoadingThread(false);
    }
  };

  useEffect(() => { loadThreads(); }, []);
  useEffect(() => { loadThread(selectedKey); }, [selectedKey]);

  const selectThread = (key) => {
    setSelectedKey(key);
    setComposing(false);
    setSearchParams(key ? { thread: key } : {});
  };

  const onNewThreadSent = (broadcast) => {
    setComposing(false);
    loadThreads();
    if (broadcast.thread_key) selectThread(broadcast.thread_key);
  };

  const sendReply = async () => {
    if (!reply.trim() || !thread) return;
    setSendingReply(true);
    setError('');
    try {
      await apiRequest('/api/communications/send', {
        method: 'POST',
        body: { audience: thread.thread_key, audience_label: thread.audience_label, message: reply.trim() },
      });
      setReply('');
      await loadThread(selectedKey);
      loadThreads();
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingReply(false);
    }
  };

  const sortedThreads = useMemo(
    () => [...threads].sort((a, b) => new Date(b.last_sent_at) - new Date(a.last_sent_at)),
    [threads]
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-terracotta/10 border border-terracotta/20 flex items-center justify-center shrink-0">
          <MessagesSquare className="w-5 h-5 text-terracotta" />
        </div>
        <div>
          <h1 className="font-display text-2xl text-ink">Messages</h1>
          <p className="text-sm text-ink-soft">Threaded messages to a class or an individual student/parent</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-destructive/8 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Thread list */}
        <div className="lg:col-span-2 space-y-3">
          <button
            onClick={() => { setComposing(true); setSelectedKey(''); setSearchParams({}); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition"
          >
            <Plus className="w-4 h-4" />
            New message
          </button>

          <div className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden divide-y divide-cream-deep/50 max-h-[560px] overflow-y-auto">
            {loadingThreads ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse space-y-2">
                    <div className="h-3 bg-cream-deep rounded w-1/2" />
                    <div className="h-3 bg-cream-deep rounded w-3/4" />
                  </div>
                ))}
              </div>
            ) : sortedThreads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <MessagesSquare className="w-8 h-8 text-ink-soft/40 mb-3" />
                <p className="text-sm font-medium text-ink">No threads yet</p>
                <p className="text-xs text-ink-soft mt-1">Start a new message to a class or a student.</p>
              </div>
            ) : (
              sortedThreads.map((t) => (
                <button
                  key={t.thread_key}
                  onClick={() => selectThread(t.thread_key)}
                  className={`w-full flex items-start gap-3 p-3 text-left transition hover:bg-cream-deep/30 ${
                    selectedKey === t.thread_key ? 'bg-terracotta/5' : ''
                  }`}
                >
                  <ThreadIcon threadKey={t.thread_key} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink truncate">{t.audience_label}</span>
                      <span className="text-[11px] text-ink-soft shrink-0">{timeAgo(t.last_sent_at)}</span>
                    </div>
                    <p className="text-xs text-ink-soft truncate mt-0.5">{t.last_message}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Conversation / composer */}
        <div className="lg:col-span-3">
          {composing ? (
            <NewThreadComposer onSent={onNewThreadSent} onClose={() => setComposing(false)} />
          ) : !selectedKey ? (
            <div className="rounded-2xl bg-white border border-cream-deep/70 h-full min-h-[400px] flex flex-col items-center justify-center text-center p-8">
              <MessagesSquare className="w-8 h-8 text-ink-soft/40 mb-3" />
              <p className="text-sm font-medium text-ink">Select a thread</p>
              <p className="text-xs text-ink-soft mt-1 max-w-xs">Pick a class or student on the left, or start a new message.</p>
            </div>
          ) : loadingThread || !thread ? (
            <div className="rounded-2xl bg-white border border-cream-deep/70 h-full min-h-[400px] p-4 space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-cream-deep rounded-2xl w-2/3 ml-auto animate-pulse" />)}
            </div>
          ) : (
            <div className="rounded-2xl bg-white border border-cream-deep/70 flex flex-col h-[560px]">
              <div className="px-4 py-3 border-b border-cream-deep/60 flex items-center gap-2">
                <ThreadIcon threadKey={thread.thread_key} />
                <div>
                  <div className="text-sm font-semibold text-ink">{thread.audience_label}</div>
                  <div className="text-[11px] text-ink-soft">{thread.messages.length} message{thread.messages.length === 1 ? '' : 's'}</div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#efeae2]/30">
                {thread.messages.map((m) => (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#dcf8c6] px-3 py-2 shadow-sm">
                      <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{m.message}</p>
                      <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-ink-soft/70">
                        <span>{m.sent_by_name || 'Staff'}</span>
                        <span>·</span>
                        <span>{new Date(m.sent_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        <CheckCheck className="w-3 h-3 text-[#53bdeb]" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 border-t border-cream-deep/60 flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value.slice(0, 1000))}
                  rows={2}
                  placeholder="Send another message to this thread…"
                  className="flex-1 px-3 py-2 rounded-lg border border-cream-deep bg-white text-sm text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-terracotta/30 focus:border-terracotta/50 resize-none transition"
                />
                <button
                  onClick={sendReply}
                  disabled={!reply.trim() || sendingReply}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-terracotta text-primary-foreground text-sm font-medium hover:bg-terracotta-deep transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
