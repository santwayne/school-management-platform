import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck2, Bus, MessageSquare, IndianRupee, Send, UserPlus, FilePlus2, TrendingUp } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';

const INR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

function StatCard({ label, value, sub, icon: Icon }) {
  return (
    <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-ink-soft">{label}</span>
        <div className="w-8 h-8 rounded-lg bg-terracotta/10 text-terracotta-deep flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="font-display text-2xl text-ink">{value}</div>
      {sub && <div className="text-xs text-ink-soft">{sub}</div>}
    </div>
  );
}

function Card({ title, subtitle, children, className = '' }) {
  return (
    <div className={`rounded-2xl bg-white border border-cream-deep/70 p-5 ${className}`}>
      <div className="mb-4">
        <h3 className="font-display text-lg text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-soft mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export default function AdminHome() {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [attendanceTrend, setAttendanceTrend] = useState([]);
  const [feesTrend, setFeesTrend] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiRequest('/api/reports/overview'),
      apiRequest('/api/reports/attendance-trend'),
      apiRequest('/api/reports/fees-trend'),
    ])
      .then(([o, a, f]) => {
        setOverview(o);
        setAttendanceTrend(a.map((r) => ({ d: new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), v: Number(r.pct) })));
        setFeesTrend(f.map((r) => ({ d: new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), v: Number(r.total) })));
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-ink">Good day, {user?.name?.split(' ')[0] || 'there'}</h1>
          <p className="text-sm text-ink-soft mt-1">Here's what's happening across your school today.</p>
        </div>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <StatCard label="Attendance today" value={overview.attendance_today_pct ? `${overview.attendance_today_pct}%` : '—'} icon={CalendarCheck2} />
          <StatCard label="Fees this month" value={INR(overview.fees_this_month)} icon={IndianRupee} />
          <StatCard label="WhatsApp reach (7d)" value={overview.broadcasts_this_week} sub="recipients" icon={Send} />
          <StatCard label="Bus routes" value={overview.active_buses} icon={Bus} />
          <StatCard label="Parent doubts (7d)" value={overview.doubts_this_week} icon={MessageSquare} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Attendance trend" subtitle="Last 30 days · school-wide">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={attendanceTrend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.02 76)" vertical={false} />
                <XAxis dataKey="d" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => [`${v}%`, 'Attendance']} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Line type="monotone" dataKey="v" stroke="oklch(0.60 0.19 38)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Fee collection" subtitle="Last 30 days, daily total">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={feesTrend} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <XAxis dataKey="d" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => [INR(v), 'Collected']} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="v" fill="oklch(0.60 0.19 38)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Recent activity" subtitle="Live from across the school" className="lg:col-span-2">
          {overview && overview.activity.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-cream-deep/60">
              {overview?.activity.map((a, i) => (
                <li key={i} className="py-3 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-cream-deep/70 flex items-center justify-center text-xs font-medium text-ink-soft shrink-0">
                    {a.type === 'payment' ? '₹' : '📢'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink">
                      {a.type === 'payment' ? (
                        <><span className="font-medium">{a.who}</span> <span className="text-ink-soft">paid {INR(a.amount)}</span></>
                      ) : (
                        <><span className="text-ink-soft">Broadcast sent to</span> <span className="font-medium">{a.who}</span> <span className="text-ink-soft">({a.amount} recipients)</span></>
                      )}
                    </p>
                    <p className="text-xs text-ink-soft/80 mt-0.5">{new Date(a.when).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Quick actions" subtitle="Jump to common tasks">
          <div className="grid grid-cols-2 gap-2">
            <Link to="/admin/communications" className="flex flex-col items-start gap-2 p-3 rounded-xl bg-cream-deep/40 hover:bg-terracotta/10 hover:text-terracotta-deep transition text-left">
              <Send className="w-4 h-4 text-terracotta-deep" />
              <span className="text-sm font-medium">Send announcement</span>
            </Link>
            <Link to="/classes" className="flex flex-col items-start gap-2 p-3 rounded-xl bg-cream-deep/40 hover:bg-terracotta/10 hover:text-terracotta-deep transition text-left">
              <UserPlus className="w-4 h-4 text-terracotta-deep" />
              <span className="text-sm font-medium">Add student</span>
            </Link>
            <Link to="/admin/reports" className="flex flex-col items-start gap-2 p-3 rounded-xl bg-cream-deep/40 hover:bg-terracotta/10 hover:text-terracotta-deep transition text-left">
              <FilePlus2 className="w-4 h-4 text-terracotta-deep" />
              <span className="text-sm font-medium">Generate report</span>
            </Link>
            <Link to="/dashboard-alerts" className="flex flex-col items-start gap-2 p-3 rounded-xl bg-cream-deep/40 hover:bg-terracotta/10 hover:text-terracotta-deep transition text-left">
              <TrendingUp className="w-4 h-4 text-terracotta-deep" />
              <span className="text-sm font-medium">Performance alerts</span>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
