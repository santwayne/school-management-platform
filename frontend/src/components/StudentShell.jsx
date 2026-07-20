import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Sparkles, BookOpen, TrendingUp, Trophy, Flame, Zap, NotebookPen, LogOut } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { apiRequest } from '../api';

const NAV = [
  { to: '/student', label: 'Home', icon: Home, exact: true },
  { to: '/tutor', label: 'Ask AI Tutor', icon: Sparkles },
  { to: '/homework', label: 'Homework', icon: BookOpen },
  { to: '/notes', label: 'Notes', icon: NotebookPen },
  { to: '/progress', label: 'My Progress', icon: TrendingUp },
  { to: '/rewards', label: 'Rewards', icon: Trophy },
];

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

export default function StudentShell({ children }) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const [rewards, setRewards] = useState(null);
  const [homework, setHomework] = useState(null);

  useEffect(() => {
    apiRequest('/api/student/rewards').then(setRewards).catch(() => {});
    apiRequest('/api/student/homework').then(setHomework).catch(() => {});
  }, [pathname]); // refetch on nav so streak/XP and homework counts stay current

  const hwDone = homework ? homework.filter((h) => h.done).length : null;
  const hwTotal = homework ? homework.length : null;

  return (
    <div className="min-h-screen bg-cream text-ink font-sans flex flex-col lg:flex-row">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-cream-deep/60 bg-white/70 backdrop-blur px-4 py-6 gap-2 sticky top-0 h-screen">
        <div className="flex items-center gap-2 px-2 pb-4">
          <div className="h-9 w-9 rounded-2xl bg-terracotta flex items-center justify-center text-white font-display text-lg">W</div>
          <span className="font-display text-xl">Waynur</span>
          <span className="ml-auto text-[10px] font-semibold tracking-wider text-terracotta-deep bg-terracotta/10 px-2 py-0.5 rounded-full">STUDENT</span>
        </div>
        <nav className="flex flex-col gap-1.5">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium transition ${
                  active ? 'bg-terracotta text-white shadow-sm' : 'text-ink-soft hover:bg-cream-deep/60 hover:text-ink'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="rounded-2xl p-4 bg-gradient-to-br from-joy-gold/40 to-joy-leaf/30 border border-joy-gold/40">
            <div className="text-xs text-ink-soft">Homework done</div>
            <div className="mt-1 text-sm font-semibold">
              {hwTotal !== null ? `${hwDone} of ${hwTotal} tasks` : '…'}
            </div>
            <div className="mt-2 h-2 rounded-full bg-white/60 overflow-hidden">
              <div
                className="h-full bg-joy-leaf transition-all duration-700"
                style={{ width: `${hwTotal ? Math.min(100, (hwDone / hwTotal) * 100) : 0}%` }}
              />
            </div>
          </div>

          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-2xl text-sm font-medium text-ink-soft hover:bg-cream-deep/60 hover:text-terracotta-deep transition"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 px-5 lg:px-8 py-3 bg-cream/85 backdrop-blur border-b border-cream-deep/60">
          <div className="lg:hidden flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-terracotta flex items-center justify-center text-white font-display">W</div>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-warm/20 border border-joy-gold/50">
              <Flame className="w-4 h-4 text-terracotta" />
              <span className="text-sm font-semibold text-ink">{rewards ? rewards.streak : '—'}</span>
              <span className="hidden sm:inline text-xs text-ink-soft">day streak</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-joy-gold/25 border border-joy-gold/60">
              <Zap className="w-4 h-4 text-terracotta-deep" />
              <span className="text-sm font-semibold">{rewards ? rewards.xp.toLocaleString('en-IN') : '—'}</span>
              <span className="hidden sm:inline text-xs text-ink-soft">XP</span>
            </div>
            <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-cream-deep">
              <div className="w-8 h-8 rounded-full bg-joy-gold flex items-center justify-center text-ink font-semibold text-sm">{initials(user?.name)}</div>
              <div className="hidden sm:block leading-tight">
                <div className="text-sm font-semibold">{user?.name?.split(' ')[0]}</div>
                <div className="text-xs text-ink-soft">{user?.class_name || 'Student'}</div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-5 lg:px-8 py-6 pb-28 lg:pb-8 max-w-[1200px] w-full space-y-6">
          {children}
        </main>

        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur border-t border-cream-deep/70 px-2 py-2 flex justify-around">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl text-[10px] font-medium min-w-14 ${active ? 'text-terracotta' : 'text-ink-soft'}`}
              >
                <Icon className={`w-5 h-5 ${active ? 'scale-110' : ''} transition-transform`} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
