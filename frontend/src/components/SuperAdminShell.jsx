import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Building2, Receipt, ShieldCheck, LogOut, Mic, Menu, X } from 'lucide-react';
import { useAuth } from '../AuthContext';

const NAV = [
  { label: 'Overview', icon: LayoutDashboard, to: '/super-admin' },
  { label: 'Schools', icon: Building2, to: '/super-admin/schools' },
  { label: 'AI Voice Tutor', icon: Mic, to: '/super-admin/ai-voice-tutor' },
  { label: 'Subscriptions & Billing', icon: Receipt, to: '/super-admin/billing' },
];

export default function SuperAdminShell({ children }) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  // P-11: same 'hidden lg:flex, no mobile fallback' pattern as AdminShell.jsx.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const sidebarContent = (
    <>
      <div className="flex items-center gap-2 px-2 pb-1">
        <div className="h-9 w-9 rounded-lg bg-ink text-cream flex items-center justify-center font-display font-semibold">W</div>
        <div className="leading-tight">
          <div className="font-display text-lg text-ink">Waynur</div>
          <div className="text-[10px] tracking-wider text-ink-soft">WAYNE E SOLUTIONS</div>
        </div>
      </div>
      <div className="mx-2 mb-5 mt-1 inline-flex items-center gap-1.5 self-start px-2 py-0.5 rounded-md bg-terracotta/10 text-terracotta-deep text-[10px] font-semibold tracking-wider">
        <ShieldCheck className="w-3 h-3" /> SUPER ADMIN
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition ${
                active ? 'bg-terracotta/10 text-terracotta-deep font-medium border-l-2 border-terracotta' : 'text-ink-soft hover:bg-cream-deep/50 hover:text-ink'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <div className="flex min-h-screen bg-cream text-ink font-sans">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-cream-deep/70 bg-ink/[0.03] px-4 py-6 gap-1 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-ink/40" onClick={() => setMobileNavOpen(false)} />
          <aside className="relative flex w-64 max-w-[80vw] flex-col bg-white px-4 py-6 gap-1 h-screen overflow-y-auto shadow-xl">
            <button
              onClick={() => setMobileNavOpen(false)}
              className="absolute top-4 right-3 p-1.5 rounded-lg hover:bg-cream-deep/60 text-ink-soft"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="sticky top-0 z-10 flex items-center gap-4 px-4 sm:px-8 py-3 border-b border-cream-deep/70 bg-cream/80 backdrop-blur-md justify-between sm:justify-end">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-cream-deep/60 text-ink-soft shrink-0"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-4">
            <button onClick={logout} className="p-2 rounded-lg hover:bg-cream-deep/60 transition text-ink-soft hover:text-terracotta-deep" aria-label="Log out">
              <LogOut className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 pl-3 border-l border-cream-deep">
              <div className="w-8 h-8 rounded-full bg-ink/10 text-ink font-medium text-sm flex items-center justify-center">
                {user?.name ? user.name[0].toUpperCase() : '?'}
              </div>
              <div className="hidden sm:block leading-tight">
                <div className="text-sm font-medium">{user?.name}</div>
                <div className="text-xs text-ink-soft">Super Admin</div>
              </div>
            </div>
          </div>
        </div>
        <main className="flex-1 px-8 py-6 space-y-6 max-w-[1400px] w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
