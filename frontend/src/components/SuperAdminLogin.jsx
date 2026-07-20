import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, Lock } from 'lucide-react';

export default function SuperAdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { superAdminLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await superAdminLogin(email, password);
      navigate('/super-admin');
    } catch (err) {
      setError(err.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen font-sans flex flex-col"
      style={{
        background: 'radial-gradient(ellipse 900px 500px at 50% -10%, rgba(180,60,20,0.5) 0%, transparent 65%), #0d0b09',
      }}
    >
      {/* Top bar */}
      <div className="px-6 py-5 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <span className="grid place-items-center h-8 w-8 rounded-full bg-terracotta text-white font-display font-semibold text-sm">
            W
          </span>
          <span className="font-display text-lg font-semibold text-white group-hover:text-white/80 transition">
            Waynur
          </span>
        </Link>
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/90 transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          School login
        </Link>
      </div>

      {/* Centered content */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px]">

          {/* Icon + heading */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="h-16 w-16 rounded-2xl bg-terracotta/25 border border-terracotta/40 flex items-center justify-center mb-5">
              <ShieldCheck className="h-8 w-8 text-terracotta" strokeWidth={1.8} />
            </div>
            <h1 className="font-display text-3xl font-semibold text-white tracking-tight">
              Platform Access
            </h1>
            <p className="text-sm text-white/50 mt-2">Waynur Super Admin Portal</p>
          </div>

          {/* Form card */}
          <div
            className="rounded-2xl p-7 backdrop-blur-md"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            {error && (
              <div className="mb-5 px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300 flex items-start gap-2">
                <span className="mt-0.5 shrink-0">⚠</span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-1.5">
                  Admin email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="admin@waynur.com"
                  className="w-full px-4 py-3 text-sm rounded-xl bg-white text-gray-900 border border-white/10 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-terracotta/60 focus:border-terracotta/40 transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full px-4 py-3 text-sm rounded-xl bg-white text-gray-900 border border-white/10 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-terracotta/60 focus:border-terracotta/40 transition"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email.trim() || !password.trim()}
                className="w-full mt-1 py-3 rounded-xl bg-terracotta text-white font-semibold text-sm hover:bg-terracotta-deep transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Signing in…
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    Access Platform
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Footer note */}
          <p className="mt-6 text-center text-[11px] text-white/30 tracking-wide">
            RESTRICTED ACCESS — WAYNE E SOLUTIONS INTERNAL USE ONLY
          </p>
        </div>
      </div>
    </div>
  );
}
