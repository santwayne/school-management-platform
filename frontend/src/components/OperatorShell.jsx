import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Gauge, Inbox, Workflow, ScrollText, Settings2, LogOut, Menu, X, UserPlus2, MessagesSquare } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { apiRequest } from '../api';
import AdminShell from './AdminShell';

const NAV = [
  { label: 'Control Center', icon: Gauge, to: '/ops' },
  { label: 'Inbox', icon: Inbox, to: '/ops/inbox', badge: true },
  { label: 'Admissions', icon: UserPlus2, to: '/ops/admissions' },
  { label: 'Parent messages', icon: MessagesSquare, to: '/ops/parents' },
  { label: 'Automations', icon: Workflow, to: '/ops/automations' },
  { label: 'Activity log', icon: ScrollText, to: '/ops/audit' },
  { label: 'Daily report', icon: Settings2, to: '/ops/settings' },
];

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

function OperatorLayout({ children }) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const [schoolName, setSchoolName] = useState('');
  const [openCount, setOpenCount] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    apiRequest('/api/settings').then((s) => setSchoolName(s.school_name || '')).catch(() => {});
  }, []);

  useEffect(() => {
    const load = () => apiRequest('/api/ops/overview').then((d) => setOpenCount(d.exceptions.total)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => setMobileNavOpen(false), [pathname]);

  const isActive = (to) => (to === '/ops' ? pathname === '/ops' : pathname.startsWith(to));

  const sidebar = (
    <>
      <div className="flex items-center gap-2 px-2 pb-6">
        <div className="h-8 w-8 rounded-lg bg-terracotta flex items-center justify-center text-primary-foreground font-display font-semibold">W</div>
        <span className="font-display text-xl text-ink">Waynur</span>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta ${
                active ? 'bg-terracotta/10 text-terracotta-deep font-medium' : 'text-ink-soft hover:bg-cream-deep/50 hover:text-ink'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="flex-1">{item.label}</span>
              {item.badge && openCount > 0 && (
                <span className="min-w-5 h-5 px-1.5 rounded-full bg-terracotta text-white text-[11px] font-semibold flex items-center justify-center">
                  {openCount > 99 ? '99+' : openCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <div className="flex min-h-screen bg-cream text-ink font-sans">
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-cream-deep/70 bg-white/60 px-4 py-6 sticky top-0 h-screen">{sidebar}</aside>

      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-ink/40" onClick={() => setMobileNavOpen(false)} />
          <aside className="relative flex w-64 max-w-[80vw] flex-col bg-white px-4 py-6 h-screen overflow-y-auto shadow-xl">
            <button onClick={() => setMobileNavOpen(false)} className="absolute top-4 right-3 p-1.5 rounded-lg hover:bg-cream-deep/60 text-ink-soft" aria-label="Close menu">
              <X className="w-5 h-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="sticky top-0 z-10 flex items-center gap-4 px-4 sm:px-8 py-3 border-b border-cream-deep/70 bg-cream/90 backdrop-blur-md">
          <button onClick={() => setMobileNavOpen(true)} className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-cream-deep/60 text-ink-soft" aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </button>
          {schoolName && <span className="hidden md:block text-sm font-medium text-ink">{schoolName}</span>}
          <div className="ml-auto flex items-center gap-3">
            <button onClick={logout} className="p-2 rounded-lg hover:bg-cream-deep/60 text-ink-soft hover:text-terracotta-deep" aria-label="Log out">
              <LogOut className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 pl-3 border-l border-cream-deep">
              <div className="w-8 h-8 rounded-full bg-terracotta/15 text-terracotta-deep font-medium text-sm flex items-center justify-center">{initials(user?.name)}</div>
              <div className="hidden sm:block leading-tight">
                <div className="text-sm font-medium">{user?.name}</div>
                <div className="text-xs text-ink-soft">Operator</div>
              </div>
            </div>
          </div>
        </div>
        <main className="flex-1 px-4 sm:px-8 py-6 space-y-6 max-w-[1200px] w-full">{children}</main>
      </div>
    </div>
  );
}

// The principal reaches the same screens from their own admin sidebar, so
// they keep their full navigation; the operator gets the focused shell.
function PrincipalOpsTabs() {
  const { pathname } = useLocation();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-cream-deep/70 -mt-2 pb-2">
      {NAV.map((item) => {
        const active = item.to === '/ops' ? pathname === '/ops' : pathname.startsWith(item.to);
        return (
          <Link key={item.to} to={item.to} className={`px-3 py-1.5 rounded-lg text-sm ${active ? 'bg-terracotta/10 text-terracotta-deep font-medium' : 'text-ink-soft hover:text-ink'}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function OperatorShell({ children }) {
  const { user } = useAuth();
  if (user?.role === 'principal') {
    return (
      <AdminShell>
        <PrincipalOpsTabs />
        {children}
      </AdminShell>
    );
  }
  return <OperatorLayout>{children}</OperatorLayout>;
}
