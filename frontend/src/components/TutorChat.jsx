import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';

const SUBJECTS = ['Maths', 'Science', 'English', 'Social Studies', 'Hindi', 'Punjabi', 'Other'];

function ChatBubble({ role, content }) {
  const isStudent = role === 'user';
  return (
    <div className={`flex ${isStudent ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${
          isStudent ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'
        }`}
      >
        {content}
      </div>
    </div>
  );
}

export default function TutorChat() {
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState(null);
  const [subject, setSubject] = useState(SUBJECTS[0]);
  const [grade, setGrade] = useState(user?.grade || '');
  const [messages, setMessages] = useState([]); // { role, content }
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError('');
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const data = await apiRequest('/api/tutor/ask', {
        method: 'POST',
        body: {
          session_id: sessionId,
          subject: sessionId ? undefined : subject,
          grade: sessionId ? undefined : grade,
          message: text,
        },
      });
      setSessionId(data.session_id);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(err.message || 'Something went wrong — please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startNewQuestion = () => {
    setSessionId(null);
    setMessages([]);
    setInput('');
    setError('');
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="bg-white rounded-xl border shadow-sm flex flex-col h-[75vh]">
        <div className="border-b p-4 flex items-center justify-between">
          <div>
            <h1 className="font-bold text-gray-900">Ask for Help</h1>
            <p className="text-xs text-gray-500">Your AI tutor guides you — it won't just give you the answer.</p>
          </div>
          {messages.length > 0 && (
            <button onClick={startNewQuestion} className="text-xs font-medium text-indigo-600 hover:underline">
              New question
            </button>
          )}
        </div>

        {messages.length === 0 && (
          <div className="p-4 border-b flex gap-3 flex-wrap">
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Subject</label>
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="border rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
              >
                {SUBJECTS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Grade</label>
              <input
                type="text"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                placeholder="e.g. Class 8"
                className="border rounded-lg p-2 text-sm w-32 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p className="text-sm text-gray-400 text-center mt-10">
              Type your homework question below to get started.
            </p>
          )}
          {messages.map((m, i) => (
            <ChatBubble key={i} role={m.role} content={m.content} />
          ))}
          {loading && (
            <div className="flex justify-start mb-3">
              <div className="bg-gray-100 text-gray-400 rounded-2xl rounded-bl-sm px-4 py-2 text-sm">Thinking...</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <div className="px-4 py-2 text-xs bg-red-50 text-red-700">{error}</div>}

        <div className="border-t p-3 flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your question or your next attempt..."
            rows={1}
            className="flex-1 border rounded-lg p-2 text-sm resize-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="bg-indigo-600 text-white px-4 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
