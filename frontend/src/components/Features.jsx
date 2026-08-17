import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, CalendarCheck, MessageCircle, Sparkles, Fingerprint, Wallet, Bus,
  BookOpen, ClipboardList, Users, ShieldCheck, GraduationCap, Bell,
} from 'lucide-react';
import { LandingNav, LandingFooter } from './LandingLayout';

const GROUPS = [
  {
    title: 'Attendance & communication',
    tag: 'The daily heartbeat',
    items: [
      { icon: CalendarCheck, title: 'Attendance, taken in seconds', body: 'Biometric or teacher-marked attendance, class by class. Parents know before assembly ends.' },
      { icon: MessageCircle, title: 'WhatsApp for every parent', body: 'Marks, homework, fee reminders and absence alerts — delivered warmly, in the language a family already uses.' },
      { icon: Bell, title: 'Staff broadcasts', body: 'Send a circular to every teacher, or just one class — from a single composer, with delivery tracking.' },
    ],
  },
  {
    title: 'Teaching & learning',
    tag: 'For classrooms',
    items: [
      { icon: Sparkles, title: 'AI tutor for every student', body: 'A patient guide that explains the \u2018why\u2019 behind every answer — reviewed by teachers, not a replacement for them.' },
      { icon: BookOpen, title: 'Lesson plans & syllabus tracking', body: 'Teachers plan against the syllabus and mark progress as they go; principals see coverage at a glance.' },
      { icon: ClipboardList, title: 'AI-assisted grading', body: 'Draft grades and feedback for objective answers in minutes, with a teacher review step before anything is final.' },
    ],
  },
  {
    title: 'Operations',
    tag: 'Running the school',
    items: [
      { icon: Fingerprint, title: 'Biometric & bus tracking', body: 'The gentle peace of mind of knowing your child boarded, arrived and is safe — with live route visibility for admins.' },
      { icon: Wallet, title: 'Fees & payroll, quietly done', body: 'Collections, receipts and staff payouts — automated, auditable, and reconciled without spreadsheets.' },
      { icon: Bus, title: 'Transport payouts', body: 'Driver and vendor payments tracked alongside routes, so transport finance stops living in a separate notebook.' },
    ],
  },
  {
    title: 'Admin & trust',
    tag: 'One dashboard, every role',
    items: [
      { icon: Users, title: 'Role-based dashboards', body: 'Principals see everything. Teachers see their class. Accountants see finance. Parents and students see their own.' },
      { icon: GraduationCap, title: 'Report cards & certificates', body: 'Generate report cards and student certificates directly from the records already in Waynur — no re-typing.' },
      { icon: ShieldCheck, title: 'Role-based access & audit logs', body: 'Every action is scoped to a role and traceable, with data hosted in India and a parent-consent-first design.' },
    ],
  },
];

export default function Features() {
  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <LandingNav />

      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-70"
          style={{ background: 'radial-gradient(1200px 600px at 90% -10%, oklch(0.9 0.09 75 / 0.55), transparent 60%), radial-gradient(900px 500px at -10% 30%, oklch(0.85 0.06 40 / 0.35), transparent 60%)' }}
        />
        <div className="mx-auto max-w-7xl px-6 pt-16 pb-10">
          <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">What Waynur does</p>
          <h1 className="mt-3 font-display text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-ink">
            Everything a school needs.<br className="hidden md:block" /> Nothing that gets in the way.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-soft leading-relaxed">
            One calm, WhatsApp-first platform for attendance, teaching, fees, transport and payroll —
            with an AI co-pilot woven in wherever it genuinely saves time.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 space-y-20">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">{group.tag}</p>
            <h2 className="mt-2 font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink">{group.title}</h2>
            <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {group.items.map((f) => (
                <div key={f.title} className="group rounded-3xl border border-cream-deep bg-white p-7 hover:shadow-lg hover:-translate-y-0.5 transition">
                  <div className="h-11 w-11 rounded-2xl bg-terracotta/10 grid place-items-center text-terracotta-deep">
                    <f.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 font-display text-lg font-semibold text-ink">{f.title}</h3>
                  <p className="mt-2 text-sm text-ink-soft leading-relaxed">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="rounded-[2rem] bg-gradient-to-br from-terracotta to-terracotta-deep text-white p-10 md:p-16 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">See which plan fits your school.</h2>
          <p className="mt-3 text-white/85 max-w-xl mx-auto">Every plan starts with a free walkthrough tailored to your school.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/pricing" className="inline-flex items-center gap-2 rounded-full bg-white text-terracotta-deep px-6 py-3.5 text-sm font-semibold shadow-md hover:scale-[1.03] transition-transform">
              View pricing <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/onboarding" className="inline-flex items-center gap-2 rounded-full border border-white/40 px-6 py-3.5 text-sm font-medium hover:bg-white/10 transition">
              Set up Waynur
            </Link>
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
