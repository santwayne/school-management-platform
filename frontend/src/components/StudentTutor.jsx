import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Mic, MicOff, Keyboard, Sparkles, RotateCcw, Volume2, VolumeX } from 'lucide-react';
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

  async function sendImpl(text) {
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const send = useCallback(sendImpl, [loading, sessionId, subject, user]);

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
            <InAppVoiceTutorPanel
              onTranscript={send}
              loading={loading}
              lastTutorReply={[...messages].reverse().find((m) => m.role === 'tutor')?.text}
            />
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

// ------------------------------------------------------------------
// In-app voice tutor — device-native STT/TTS only (Web Speech API on
// web/desktop; the same component works unchanged if wrapped for a
// React Native mobile build using the native SpeechRecognizer/TTS APIs
// behind an equivalent interface). No telephony, no cloud STT/TTS call —
// this sends plain text into the exact same /api/tutor/ask pipeline as
// typed chat (see the `send` function above), so cost/pattern is
// identical to text chat and AI Grading. See routes/aiVoiceTutor.js for
// why the old Vapi phone-call approach doesn't apply to an in-app feature.
// ------------------------------------------------------------------
function InAppVoiceTutorPanel({ onTranscript, loading, lastTutorReply }) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const recognitionRef = useRef(null);
  const spokenRepliesRef = useRef(new Set());

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition || !window.speechSynthesis) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-IN'; // matches the platform's Hindi/Punjabi/English mix; browser falls back gracefully if unavailable

    recognition.onresult = (event) => {
      let finalText = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }
      setInterimText(interim);
      if (finalText.trim()) {
        setInterimText('');
        onTranscript(finalText.trim());
      }
    };
    recognition.onerror = (event) => {
      setError(event.error === 'not-allowed' ? 'Microphone permission was denied.' : `Voice input error: ${event.error}`);
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, [onTranscript]);

  // Speak each new tutor reply aloud automatically, once, using the
  // device's own speech synthesis — no cloud call, no per-word cost.
  useEffect(() => {
    if (!supported || !speakEnabled || !lastTutorReply) return;
    if (spokenRepliesRef.current.has(lastTutorReply)) return;
    spokenRepliesRef.current.add(lastTutorReply);

    const utterance = new SpeechSynthesisUtterance(lastTutorReply);
    utterance.lang = 'en-IN';
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    window.speechSynthesis.cancel(); // don't overlap with a previous reply
    window.speechSynthesis.speak(utterance);
  }, [lastTutorReply, speakEnabled, supported]);

  const toggleListening = () => {
    setError('');
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    try {
      recognitionRef.current?.start();
      setListening(true);
    } catch {
      // start() throws if called twice in quick succession — safe to ignore
    }
  };

  if (!supported) {
    return (
      <div className="flex flex-col items-center py-4 gap-2">
        <div className="w-16 h-16 rounded-full bg-cream-deep/60 text-ink-soft flex items-center justify-center">
          <MicOff className="w-7 h-7" />
        </div>
        <p className="text-xs text-ink-soft text-center max-w-xs">
          Voice isn't supported in this browser — try Chrome, or use text chat instead.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-4 gap-3">
      <button
        onClick={toggleListening}
        disabled={loading}
        className={`w-16 h-16 rounded-full flex items-center justify-center transition disabled:opacity-50 ${
          listening ? 'bg-terracotta text-white animate-pulse' : 'bg-terracotta/10 text-terracotta-deep hover:bg-terracotta/20'
        }`}
      >
        <Mic className="w-7 h-7" />
      </button>
      <p className="text-xs text-ink-soft text-center min-h-[1rem]">
        {listening ? (interimText || 'Listening…') : loading ? 'Thinking…' : 'Tap the mic and ask your question'}
      </p>

      <button
        onClick={() => {
          if (speaking) window.speechSynthesis.cancel();
          setSpeakEnabled((v) => !v);
        }}
        className="text-xs text-ink-soft inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-cream-deep/40"
      >
        {speakEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
        {speakEnabled ? 'Reading replies aloud' : 'Replies muted'}
      </button>

      {error && <div className="text-xs text-destructive text-center max-w-xs">{error}</div>}
    </div>
  );
}
