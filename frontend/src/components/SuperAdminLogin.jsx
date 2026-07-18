import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, ArrowLeft } from 'lucide-react';

const darkInputClass =
  'w-full px-3.5 py-2.5 text-sm rounded-xl bg-white/8 border border-white/12 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-terracotta/50 focus:border-terracotta/50 transition';

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
        background: 'radial-gradient(ellipse 1000px 600px at 60% -5%, oklch(0.48 0.17 32 / 0.45), transparent 60%), oklch(0.12 0.025 38)',
      }}
    >
      {/* Top bar */}
      <div className="px-6 py-5 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <span className="grid place-items-center h-8 w-8 rounded-full bg-terracotta text-white font-display font-semibold text-sm">W</span>
          <span className="font-display text-lg font-semibold text-white/90 group-hover:text-white transition">Waynur</span>
        </Link>
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs text-white/45 hover:text-white/80 transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          School login
        </Link>
      </div>

      {/* Centered content */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-[380px]">

          {/* Icon + heading */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="h-16 w-16 rounded-2xl bg-terracotta/20 border border-terracotta/30 flex items-center justify-center mb-5 shadow-lg shadow-terracotta/10">
              <ShieldCheck className="h-8 w-8 text-terracotta" />
            </div>
            <h1 className="font-display text-2xl text-white tracking-tight">Platform Access</h1>
            <p className="text-sm text-white/45 mt-1.5">Waynur Super Admin Portal</p>
          </div>

          {/* Form card */}
          <div className="bg-white/6 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
            {error && (
              <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-red-500/15 border border-red-500/25 text-sm text-red-300">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="text-xs font-medium text-white/55">Admin email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="admin@waynur.com"
                  className={`mt-1.5 ${darkInputClass}`}
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-white/55">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={`mt-1.5 ${darkInputClass}`}
                />
              </label>

              <button
                type="submit"
                disabled={loading || !email.trim() || !password.trim()}
                className="w-full mt-2 py-3 rounded-xl bg-terracotta text-white font-medium text-sm hover:bg-terracotta-deep transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in…' : 'Access Platform'}
              </button>
            </form>
          </div>

          {/* Footer note */}
          <p className="mt-6 text-center text-[11px] text-white/25">
            Restricted access — Wayne E Solutions internal use only
          </p>
        </div>
      </div>
    </div>
  );
}
