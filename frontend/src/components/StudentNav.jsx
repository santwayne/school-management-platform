import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';

const TABS = [
  { to: '/tutor', label: 'Tutor', emoji: '✨' },
  { to: '/homework', label: 'Homework', emoji: '📝' },
  { to: '/notes', label: 'Notes', emoji: '📓' },
  { to: '/progress', label: 'Progress', emoji: '📈' },
  { to: '/rewards', label: 'Rewards', emoji: '🏆' },
];

export default function StudentNav() {
  const location = useLocation();
  const { logout } = useAuth();

  return (
    <div className="max-w-2xl w-full mx-auto px-4 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 bg-cream-deep/50 rounded-xl p-1 overflow-x-auto">
          {TABS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                location.pathname === t.to ? 'bg-white shadow-sm text-ink' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t.emoji} {t.label}
            </Link>
          ))}
        </div>
        <button onClick={logout} className="text-xs text-ink-soft hover:text-terracotta-deep whitespace-nowrap">
          Log out
        </button>
      </div>
    </div>
  );
}
