import React, { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import LandingLayout from './LandingLayout';

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

// Admin, Accountant, and Teacher tabs all hit the same real endpoint
// (teachers table, distinguished by role) — where we navigate after
// success depends on the role the server returns, not which tab was
// clicked.
function goToRoleHome(navigate, role) {
  if (role === 'principal') navigate('/dashboard');
  else if (role === 'accountant') navigate('/accountant');
  else navigate('/teacher');
}

function AdminForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const disabled = !email.trim() || !password.trim() || loading;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      goToRoleHome(navigate, user.role);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />
      <Field label="Email">
        <input
          type="email"
          autoComplete="email"
          placeholder="principal@school.edu.in"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </Field>
      <SubmitButton disabled={disabled}>{loading ? 'Signing in…' : 'Sign in'}</SubmitButton>
    </form>
  );
}

function TeacherForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const disabled = !email.trim() || !password.trim() || loading;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      goToRoleHome(navigate, user.role);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />
      <Field label="Email" hint="Issued by your school administrator">
        <input
          type="email"
          autoComplete="username"
          placeholder="teacher@school.edu.in"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </Field>
      <SubmitButton disabled={disabled}>{loading ? 'Signing in…' : 'Sign in'}</SubmitButton>
    </form>
  );
}

function StudentForm() {
  const [loginId, setLoginId] = useState('');
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const refs = [useRef(null), useRef(null), useRef(null), useRef(null)];
  const { studentLogin } = useAuth();
  const navigate = useNavigate();
  const disabled = !loginId.trim() || pin.some((d) => d === '') || loading;

  const setDigit = (i, v) => {
    const digit = v.replace(/\D/g, '').slice(-1);
    setPin((prev) => {
      const next = [...prev];
      next[i] = digit;
      return next;
    });
    if (digit && i < 3) refs[i + 1].current?.focus();
  };

  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !pin[i] && i > 0) refs[i - 1].current?.focus();
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await studentLogin(loginId.trim(), pin.join(''));
      navigate('/tutor');
    } catch (err) {
      setError(err.message);
      setPin(['', '', '', '']);
      refs[0].current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />
      <Field label="Login ID" hint="Ask your teacher if you don't have your Login ID">
        <input
          type="text"
          autoComplete="username"
          placeholder="STD-1-A1B2"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="4-digit PIN">
        <div className="flex gap-2">
          {pin.map((d, i) => (
            <input
              key={i}
              ref={refs[i]}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => onKey(i, e)}
              className="w-full aspect-square text-center text-xl font-semibold rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40 focus:border-terracotta/60"
            />
          ))}
        </div>
      </Field>
      <SubmitButton disabled={disabled}>{loading ? 'Signing in…' : 'Sign in'}</SubmitButton>
    </form>
  );
}

function RoleTabs({ value, onChange }) {
  const tabs = [
    { key: 'admin', label: 'Admin' },
    { key: 'accountant', label: 'Accountant' },
    { key: 'teacher', label: 'Teacher' },
    { key: 'student', label: 'Student' },
  ];
  return (
    <div className="grid grid-cols-4 p-1 bg-cream-deep/50 rounded-xl">
      {tabs.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`py-2 text-xs sm:text-sm rounded-lg transition ${
              active ? 'bg-white text-ink shadow-sm font-medium' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function Login() {
  const [role, setRole] = useState('admin');

  return (
    <LandingLayout>
      <div className="flex flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-[420px]">
          <div className="bg-white rounded-3xl border border-cream-deep shadow-sm px-6 sm:px-8 py-8 sm:py-10">
            <div className="flex flex-col items-center text-center">
              <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-terracotta/15 to-amber-warm/20 border border-cream-deep flex items-center justify-center">
                <span className="font-display text-2xl text-terracotta-deep tracking-wide">W</span>
              </div>
              <h1 className="font-display text-2xl sm:text-[26px] leading-tight text-ink mt-4">Waynur</h1>
              <div className="text-xs text-ink-soft mt-1">Sign in to your school</div>
            </div>

            <div className="mt-8">
              <RoleTabs value={role} onChange={setRole} />
            </div>

            <div className="mt-6">
              {role === 'admin' && <AdminForm />}
              {role === 'accountant' && <AdminForm />}
              {role === 'teacher' && <TeacherForm />}
              {role === 'student' && <StudentForm />}
            </div>
          </div>

          <div className="mt-5 text-center space-y-1.5">
            <p className="text-xs text-ink-soft">
              New school? <Link to="/onboarding" className="text-terracotta-deep font-medium hover:text-terracotta">Set up Waynur</Link>
            </p>
            <Link to="/super-admin-login" className="text-xs text-ink-soft hover:text-ink transition block">
              Super Admin login
            </Link>
          </div>
        </div>
      </div>
    </LandingLayout>
  );
}
