import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, CalendarCheck2, Wallet, Users, Bus, MessageSquare,
  FileBarChart, CreditCard, Settings, Bell, Sparkles, Building2, LogOut,
  ClipboardList, CalendarClock, CalendarDays, BookOpen, GraduationCap, GalleryHorizontal,
  ListChecks, UserCheck, MessagesSquare, UploadCloud, Award, FileCheck2,
  ClipboardEdit, FileText,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { apiRequest } from '../api';

// Backed by the generic, event-driven `dashboard_notifications` table
// (backend/services/notificationService.js's send() + GET/PATCH
// /api/notifications) instead of two hand-picked queries. The two legacy
// queries (petty cash, WhatsApp cash intake queue) are still mixed in
// client-side below — they don't yet push through the shared service, so
// dropping them would lose real pending-action visibility the rest of the
// app still relies on. New event sources (e.g. new_message from the
// Messages page, activity_shared) only need to call notificationService's
// send() — no frontend change required, they show up here for free.
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [pettyCash, waQueue, feed] = await Promise.all([
        apiRequest('/api/finance/petty-cash').catch(() => []),
        apiRequest('/api/fee-intake/pending').catch(() => []),
        apiRequest('/api/notifications').catch(() => ({ notifications: [], unread_count: 0 })),
      ]);

      const legacyItems = [
        ...pettyCash.filter((p) => p.status === 'PENDING').map((p) => ({
          key: `pc-${p.id}`,
          text: `Petty cash request pending: ₹${Number(p.amount).toLocaleString('en-IN')}`,
          to: '/admin/payroll',
          read: false,
          generic: false,
        })),
        ...waQueue.map((w) => ({
          key: `wa-${w.id}`,
          text: `WhatsApp cash slip needs confirming — ${w.collector_name}`,
          to: '/finance',
          read: false,
          generic: false,
        })),
      ];

      // Homework/fee/activity/message/exam notifications routed through the
      // central NotificationService — link prefers the notification's own
      // deep link, falls back to the related student's profile, then to a
      // generic destination.
      const genericItems = (feed.notifications || []).map((n) => ({
        key: `n-${n.id}`,
        id: n.id,
        text: n.title || n.body || n.trigger_event,
        to: n.link || (n.student_id ? `/admin/students/${n.student_id}/profile` : '/dashboard'),
        read: !!n.is_read,
        generic: true,
      }));

      setItems([...genericItems, ...legacyItems]);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  const unreadCount = items?.filter((n) => !n.read).length || 0;

  const handleItemClick = (n) => {
    setOpen(false);
    if (n.generic && !n.read) {
      apiRequest(`/api/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => {});
      setItems((prev) => prev.map((i) => (i.key === n.key ? { ...i, read: true } : i)));
    }
  };

  const markAllRead = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await apiRequest('/api/notifications/read-all', { method: 'PATCH' });
      setItems((prev) => prev.map((i) => (i.generic ? { ...i, read: true } : i)));
    } catch {
      // best-effort — dropdown stays interactive either way
    }
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative p-2 rounded-lg hover:bg-cream-deep/60 transition">
        <Bell className="w-5 h-5 text-ink-soft" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-terracotta text-white text-[10px] font-semibold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl border border-cream-deep/70 shadow-xl z-20 max-h-96 overflow-y-auto">
            <div className="px-4 py-3 border-b border-cream-deep/60 flex items-center justify-between">
              <span className="font-display text-sm text-ink">Needs your attention</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-[11px] text-terracotta-deep font-medium hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            {error && <div className="px-4 py-3 text-xs text-destructive">{error}</div>}
            {items && items.length === 0 && <div className="px-4 py-6 text-sm text-ink-soft text-center">Nothing pending — you're all caught up.</div>}
            {items?.map((n) => (
              <Link
                key={n.key}
                to={n.to}
                onClick={() => handleItemClick(n)}
                className={`flex items-start gap-2 px-4 py-3 text-sm hover:bg-cream-deep/30 border-b border-cream-deep/40 last:border-0 ${
                  n.read ? 'text-ink-soft' : 'text-ink'
                }`}
              >
                {!n.read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-terracotta shrink-0" />}
                <span className={n.read ? '' : 'font-medium'}>{n.text}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'Attendance', icon: CalendarCheck2, to: '/admin/attendance' },
  { label: 'Fees', icon: Wallet, to: '/finance' },
  { label: 'Staff & Payroll', icon: Users, to: '/admin/payroll' },
  { label: 'Staff Leave', icon: ClipboardList, to: '/admin/staff-leave' },
  { label: 'Optional Subjects', icon: ListChecks, to: '/optional-subjects' },
  { label: 'Student Leave', icon: UserCheck, to: '/student-leave' },
  { label: 'Timetable', icon: CalendarClock, to: '/admin/timetable' },
  { label: 'Events', icon: CalendarDays, to: '/admin/events' },
  { label: 'Library', icon: BookOpen, to: '/admin/library' },
  { label: 'Activities', icon: GalleryHorizontal, to: '/admin/activities' },
  { label: 'AI Grading', icon: GraduationCap, to: '/grading' },
  { label: 'Bulk Upload', icon: UploadCloud, to: '/admin/students/bulk-upload' },
  { label: 'Certificates', icon: Award, to: '/admin/certificates' },
  { label: 'Document Requests', icon: FileCheck2, to: '/admin/document-requests' },
  { label: 'Marks Entry', icon: ClipboardEdit, to: '/marks-entry' },
  { label: 'Report Cards', icon: FileText, to: '/report-cards' },
  { label: 'Transport', icon: Bus, to: '/admin/transport' },
  { label: 'Communications', icon: MessageSquare, to: '/admin/communications' },
  { label: 'Messages', icon: MessagesSquare, to: '/admin/messages' },
  { label: 'Reports', icon: FileBarChart, to: '/admin/reports' },
  { label: 'Billing', icon: CreditCard, to: '/admin/billing' },
  { label: 'Manage School', icon: Building2, to: '/admin/manage' },
  { label: 'Settings', icon: Settings, to: '/admin/settings' },
];

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

export default function AdminShell({ children }) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const [schoolName, setSchoolName] = useState('');

  useEffect(() => {
    apiRequest('/api/settings').then((s) => setSchoolName(s.school_name || '')).catch(() => {});
  }, []);

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="flex min-h-screen bg-cream text-ink font-sans">
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-cream-deep/70 bg-white/60 backdrop-blur-sm px-4 py-6 gap-1 sticky top-0 h-screen">
        <div className="flex items-center gap-2 px-2 pb-6 shrink-0">
          <div className="h-8 w-8 rounded-lg bg-terracotta flex items-center justify-center text-primary-foreground font-display font-semibold">W</div>
          <span className="font-display text-xl text-ink">Waynur</span>
        </div>
        <nav className="sidebar-scroll flex flex-col gap-1 flex-1 overflow-y-auto pr-1">
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
        <div className="mt-auto shrink-0 p-3 rounded-xl bg-cream-deep/60 border border-cream-deep">
          <div className="flex items-center gap-2 text-xs text-ink-soft">
            <Sparkles className="w-3.5 h-3.5 text-terracotta" />
            AI Assistant
          </div>
          <p className="text-xs text-ink-soft mt-1 leading-relaxed">
            Check Reports for this week's attendance and fee collection trends.
          </p>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="sticky top-0 z-10 flex items-center gap-4 px-8 py-3 border-b border-cream-deep/70 bg-cream/80 backdrop-blur-md">
          <div className="hidden md:flex items-center gap-2 text-sm text-ink-soft">
            <span className="font-medium text-ink">{schoolName || 'Waynur'}</span>
            <span className="text-ink-soft/60">·</span>
            <span>{today}</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
<button onClick={logout} className="p-2 rounded-lg hover:bg-cream-deep/60 transition text-ink-soft hover:text-terracotta-deep" aria-label="Log out">
              <LogOut className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 pl-3 border-l border-cream-deep">
              <div className="w-8 h-8 rounded-full bg-terracotta/15 text-terracotta-deep font-medium text-sm flex items-center justify-center">
                {initials(user?.name)}
              </div>
              <div className="hidden sm:block leading-tight">
                <div className="text-sm font-medium">{user?.name}</div>
                <div className="text-xs text-ink-soft capitalize">{user?.role}</div>
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
