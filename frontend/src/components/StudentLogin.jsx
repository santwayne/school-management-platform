import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';

export default function StudentLogin() {
  const [loginId, setLoginId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { studentLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await studentLogin(loginId.trim(), pin.trim());
      navigate('/tutor');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white p-8 rounded-xl border shadow-sm">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Student Login</h1>
        <p className="text-sm text-gray-500 mb-6">Enter your login ID and PIN to ask your AI Tutor for help.</p>

        {error && <div className="p-3 mb-4 text-sm bg-red-50 text-red-700 rounded">{error}</div>}

        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Login ID</label>
        <input
          type="text"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="e.g. STU001"
          className="w-full border rounded-lg p-2 text-sm mb-4 focus:ring-2 focus:ring-indigo-500"
          required
        />

        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">PIN</label>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="4-digit PIN"
          className="w-full border rounded-lg p-2 text-sm mb-6 focus:ring-2 focus:ring-indigo-500"
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 text-white py-2.5 rounded-md font-medium hover:bg-indigo-700 transition disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        <p className="text-xs text-gray-400 mt-4 text-center">
          Teacher or principal? <Link to="/login" className="text-indigo-600 hover:underline">Login here</Link>
        </p>
      </form>
    </div>
  );
}
