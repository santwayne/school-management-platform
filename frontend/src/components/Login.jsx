import React, { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import LandingLayout from './LandingLayout';
import WaynurMark from './WaynurMark';

const inputClass =
  'w-full px-3 py-2.5 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40 focus:border-terracotta/60 placeholder:text-ink-soft/60';

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <div className="mt-1 text-[11px] text-ink-soft">{hint}</div>}
    </label>
  );
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return <div className="p-3 mb-4 text-sm bg-destructive/10 text-destructive rounded-lg">{message}</div>;
}

function SubmitButton({ disabled, children }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full mt-2 rounded-xl bg-terracotta text-primary-foreground font-medium py-3 transition hover:bg-terracotta-deep disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

// Where we navigate after success depends on the role the server returns —
// the login page itself never asks the user to pick a role.
export function homeForRole(role) {
  if (role === 'student') return '/student';
  if (role === 'super_admin') return '/super-admin';
  if (role === 'principal') return '/dashboard';
  if (role === 'accountant') return '/accountant';
  if (role === 'operator') return '/ops';
  if (role === 'librarian') return '/admin/library';
  return '/teacher';
}

// One form for everyone. An identifier containing "@" is a staff email
// (password); anything else is a student Login ID (4-digit PIN).
function LoginForm() {
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, studentLogin } = useAuth();
  const navigate = useNavigate();
  const disabled = !identifier.trim() || !secret.trim() || loading;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const id = identifier.trim();
      const user = id.includes('@') ? await login(id, secret) : await studentLogin(id, secret.trim());
      navigate(homeForRole(user.role), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />
      <Field label="Email or Login ID" hint="Staff use the email issued by the school; students use their Login ID">
        <input
          type="text"
          autoComplete="username"
          placeholder="you@school.edu.in"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Password or PIN">
        <input
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className={inputClass}
        />
      </Field>
      <SubmitButton disabled={disabled}>{loading ? 'Signing in…' : 'Sign in'}</SubmitButton>
    </form>
  );
}

export default function Login() {
  const { user } = useAuth();
  // Already signed in: skip the login page and go straight to the dashboard.
  if (user) return <Navigate to={homeForRole(user.role)} replace />;

  return (
    <LandingLayout>
      <div className="flex flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-[420px]">
          <div className="bg-white rounded-3xl border border-cream-deep shadow-sm px-6 sm:px-8 py-8 sm:py-10">
            <div className="flex flex-col items-center text-center">
              <WaynurMark className="h-20 w-20" />
              <h1 className="font-display text-2xl sm:text-[26px] leading-tight text-ink mt-4">Waynur</h1>
              <div className="text-xs text-ink-soft mt-1">Sign in to your school</div>
            </div>

            <div className="mt-8">
              <LoginForm />
            </div>
          </div>

          <div className="mt-5 text-center space-y-1.5">
            <p className="text-xs text-ink-soft">
              New school? <Link to="/onboarding" className="text-terracotta-deep font-medium hover:text-terracotta">Set up Waynur</Link>
            </p>
          </div>
        </div>
      </div>
    </LandingLayout>
  );
}
