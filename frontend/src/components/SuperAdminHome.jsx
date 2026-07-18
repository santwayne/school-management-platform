import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { apiRequest } from '../api';

const PLAN_COLORS = { starter: '#e8c383', growth: '#e0a23f', district: '#b3441f' };

export default function SuperAdminHome() {
  const [schools, setSchools] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest('/api/super-admin/schools').then(setSchools).catch((err) => setError(err.message));
  }, []);

  const active = schools.filter((s) => s.status === 'ACTIVE' || s.status === 'active').length;
  const planCounts = ['starter', 'growth', 'district'].map((p) => ({
    name: p,
    value: schools.filter((s) => (s.plan || 'starter') === p).length,
  })).filter((p) => p.value > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-ink">Overview</h1>
        <p className="text-sm text-ink-soft mt-1">Across all Waynur schools.</p>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
          <div className="text-xs uppercase tracking-wider text-ink-soft">Total schools</div>
          <div className="font-display text-2xl text-ink mt-1">{schools.length}</div>
        </div>
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
          <div className="text-xs uppercase tracking-wider text-ink-soft">Active</div>
          <div className="font-display text-2xl text-ink mt-1">{active}</div>
        </div>
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
          <div className="text-xs uppercase tracking-wider text-ink-soft">Total students</div>
          <div className="font-display text-2xl text-ink mt-1">{schools.reduce((a, s) => a + parseInt(s.student_count || 0, 10), 0).toLocaleString('en-IN')}</div>
        </div>
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
          <div className="text-xs uppercase tracking-wider text-ink-soft">Total staff</div>
          <div className="font-display text-2xl text-ink mt-1">{schools.reduce((a, s) => a + parseInt(s.teacher_count || 0, 10), 0).toLocaleString('en-IN')}</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
          <h3 className="font-display text-lg text-ink mb-4">Plan distribution</h3>
          {planCounts.length === 0 ? (
            <p className="text-sm text-ink-soft">No schools yet.</p>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={planCounts} innerRadius={45} outerRadius={70} paddingAngle={2} dataKey="value" nameKey="name">
                    {planCounts.map((p, i) => <Cell key={i} fill={PLAN_COLORS[p.name]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-5">
          <h3 className="font-display text-lg text-ink mb-4">Recently added</h3>
          <ul className="divide-y divide-cream-deep/60">
            {schools.slice(0, 6).map((s) => (
              <li key={s.id} className="py-2.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-terracotta/10 text-terracotta-deep flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{s.name}</div>
                  <div className="text-xs text-ink-soft capitalize">{s.plan || 'starter'} plan · {s.student_count} students</div>
                </div>
              </li>
            ))}
            {schools.length === 0 && <p className="text-sm text-ink-soft">No schools yet.</p>}
          </ul>
        </div>
      </div>

      <Link to="/super-admin/schools" className="inline-block text-sm font-medium text-terracotta-deep hover:text-terracotta">
        Manage all schools →
      </Link>
    </div>
  );
}
