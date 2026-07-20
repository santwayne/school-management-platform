import React, { useEffect, useRef, useState } from 'react';
import { Send, Mic, Keyboard, Sparkles, RotateCcw } from 'lucide-react';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';
import StudentShell from './StudentShell';

const SUBJECTS = [
  { key: 'math', name: 'Math', emoji: '🧮' },
  { key: 'science', name: 'Science', emoji: '🔬' },
  { key: 'english', name: 'English', emoji: '📖' },
  { key: 'sst', name: 'Social Studies', emoji: '🌏' },
  { key: 'hindi', name: 'Hindi', emoji: '📜' },
  { key: 'computer', name: 'Computer', emoji: '💻' },
];

const SUGGESTIONS = [
  "Help me with today's Math homework",
  'Explain photosynthesis simply',
  'Give me 5 practice questions on fractions',
  'Summarise Chapter 4 of Physics',
  'How do I write a good essay intro?',
];

export default function StudentTutor() {
  const { user } = useAuth();
  const [subject, setSubject] = useState(SUBJECTS[0].key);
  const [mode, setMode] = useState('text');
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const currentSubject = SUBJECTS.find((s) => s.key === subject);

  async function send(text) {
    const t = text.trim();
    if (!t || loading) return;
    setError('');
    setInput('');
    setMessages((m) => [...m, { role: 'student', text: t }]);
    setLoading(true);
    try {
      const data = await apiRequest('/api/tutor/ask', {
        method: 'POST',
        body: {
          session_id: sessionId,
          subject: sessionId ? undefined : currentSubject.name,
          grade: sessionId ? undefined : user?.grade,
          message: t,
        },
      });
      setSessionId(data.session_id);
      setMessages((m) => [...m, { role: 'tutor', text: data.reply }]);
    } catch (err) {
      setError(err.message || 'Something went wrong — please try again.');
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    setSessionId(null);
    setMessages([]);
    setInput('');
    setError('');
  }

  return (
    <StudentShell>
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-3 pt-4 pb-4 border-b border-cream-deep/60">
          <div>
            <h1 className="font-display text-2xl text-ink">Ask AI Tutor</h1>
            <p className="text-xs text-ink-soft">Patient. Friendly. Available 24/7.</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {messages.length === 0 && (
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="text-sm px-3 py-2 rounded-xl bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40"
              >
                {SUBJECTS.map((s) => (
                  <option key={s.key} value={s.key}>{s.emoji} {s.name}</option>
                ))}
              </select>
            )}
            {messages.length > 0 && (
              <button onClick={startNew} className="text-sm px-3 py-2 rounded-xl text-ink-soft hover:bg-cream-deep/40 inline-flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" /> New question
              </button>
            )}
            <div className="flex rounded-xl bg-cream-deep/60 p-1">
              <button
                onClick={() => setMode('text')}
                className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 ${mode === 'text' ? 'bg-white shadow-sm' : 'text-ink-soft'}`}
              >
                <Keyboard className="w-4 h-4" /> Text
              </button>
              <button
                onClick={() => setMode('voice')}
                className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 ${mode === 'voice' ? 'bg-white shadow-sm' : 'text-ink-soft'}`}
              >
                <Mic className="w-4 h-4" /> Voice
              </button>
            </div>
          </div>
        </div>

        <div className="py-6 space-y-4 min-h-[40vh]">
          {messages.length === 0 ? (
            <div className="text-center">
              <div className="mx-auto w-20 h-20 rounded-3xl bg-gradient-to-br from-joy-gold to-terracotta flex items-center justify-center text-4xl shadow-lg">🦉</div>
              <h2 className="mt-4 font-display text-2xl text-ink">Hi! I'm your {currentSubject.name} tutor.</h2>
              <p className="text-ink-soft text-sm mt-1">Try one of these to get going:</p>
              <div className="mt-5 flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-sm px-4 py-2 rounded-full bg-white border border-cream-deep hover:border-terracotta/60 hover:bg-cream-deep/40 transition text-left"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === 'student' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 bg-terracotta text-primary-foreground shadow-sm whitespace-pre-wrap">{m.text}</div>
                </div>
              ) : (
                <div key={i} className="flex gap-2 items-start">
                  <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-joy-gold to-terracotta flex items-center justify-center text-lg shrink-0">🦉</div>
                  <div className="max-w-[80%] rounded-2xl rounded-tl-md px-4 py-3 bg-white border border-cream-deep/70">
                    <div className="text-[10px] font-semibold text-terracotta-deep flex items-center gap-1 mb-1">
                      <Sparkles className="w-3 h-3" /> Waynur Tutor
                    </div>
                    <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{m.text}</p>
                  </div>
                </div>
              ),
            )
          )}
          {loading && (
            <div className="flex gap-2 items-start">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-joy-gold to-terracotta flex items-center justify-center text-lg shrink-0">🦉</div>
              <div className="rounded-2xl rounded-tl-md px-4 py-3 bg-white border border-cream-deep/70 text-sm text-ink-soft">Thinking…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <div className="mb-2 px-4 py-2 text-xs rounded-xl bg-destructive/10 text-destructive">{error}</div>}

        <div className="sticky bottom-0 bg-cream/95 backdrop-blur-md border-t border-cream-deep/60 pt-3 pb-4 -mx-5 lg:-mx-8 px-5 lg:px-8">
          {mode === 'voice' ? (
            <VoiceTutorPanel subject={currentSubject.name} subjectKey={subject} studentId={user?.id} />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex gap-2 items-end"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={`Ask anything about ${currentSubject.name}…`}
                rows={1}
                className="flex-1 resize-none px-4 py-3 rounded-2xl bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40 placeholder:text-ink-soft/70 text-sm"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="w-12 h-12 rounded-2xl bg-terracotta text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:scale-105 transition"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
          )}
        </div>
      </div>
    </StudentShell>
  );
}

function VoiceTutorPanel({ subject, studentId }) {
  const [schoolEnabled, setSchoolEnabled] = useState(null);
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState('en');
  const [requesting, setRequesting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest('/api/super-admin/ai-voice-tutor/school-status')
      .then((r) => setSchoolEnabled(r.enabled))
      .catch(() => setSchoolEnabled(false));
  }, []);

  const requestCall = async () => {
    if (!phone) return setError('Enter a phone number to receive the call.');
    setRequesting(true);
    setError('');
    setResult(null);
    try {
      await apiRequest('/api/super-admin/ai-voice-tutor/start', {
        method: 'POST',
        body: { student_id: studentId, phone, subject, language },
      });
      setResult('ok');
    } catch (err) {
      setError(err.message);
    } finally {
      setRequesting(false);
    }
  };

  if (schoolEnabled === null) {
    return <div className="text-sm text-ink-soft text-center py-6">Checking availability…</div>;
  }

  if (!schoolEnabled) {
    return (
      <div className="flex flex-col items-center py-4 gap-3">
        <div className="w-16 h-16 rounded-full bg-cream-deep/60 text-ink-soft flex items-center justify-center">
          <Mic className="w-7 h-7" />
        </div>
        <p className="text-xs text-ink-soft text-center max-w-xs">
          Voice tutoring isn't turned on for your school yet — ask your principal to enable it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-4 gap-3">
      <div className="w-16 h-16 rounded-full bg-terracotta/10 text-terracotta-deep flex items-center justify-center">
        <Mic className="w-7 h-7" />
      </div>
      <p className="text-xs text-ink-soft text-center">Get a call from your AI voice tutor for {subject}.</p>
      <div className="flex gap-2 w-full max-w-xs">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+9198XXXXXXXX"
          className="flex-1 px-3 py-2 rounded-lg border border-cream-deep/70 text-sm"
        />
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className="px-2 py-2 rounded-lg border border-cream-deep/70 text-sm">
          <option value="en">English</option>
          <option value="hi">Hindi</option>
          <option value="pa">Punjabi</option>
        </select>
      </div>
      <button
        disabled={requesting}
        onClick={requestCall}
        className="px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-medium hover:bg-terracotta-deep disabled:opacity-50"
      >
        {requesting ? 'Calling…' : 'Call me now'}
      </button>
      {error && <div className="text-xs text-destructive">{error}</div>}
      {result === 'ok' && <div className="text-xs text-emerald-700">Call started — answer your phone!</div>}
    </div>
  );
}
