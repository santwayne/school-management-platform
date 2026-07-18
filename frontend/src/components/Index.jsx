import React from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, ArrowRight, ShieldCheck, Heart, CalendarCheck, MessageCircle,
  Fingerprint, Wallet, Bus, MapPin, Lock, UserCheck, Check,
} from 'lucide-react';
import heroImg from '../assets/hero-classroom.jpg';
import parentImg from '../assets/parent.jpg';
import schoolImg from '../assets/school.jpg';
import { LandingNav, LandingFooter } from './LandingLayout';

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-70"
        style={{ background: 'radial-gradient(1200px 600px at 90% -10%, oklch(0.9 0.09 75 / 0.55), transparent 60%), radial-gradient(900px 500px at -10% 30%, oklch(0.85 0.06 40 / 0.35), transparent 60%)' }}
      />
      <div className="mx-auto max-w-7xl px-6 pt-16 pb-24 grid lg:grid-cols-[1.05fr_1fr] gap-14 items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-cream-deep bg-white/60 px-3 py-1 text-xs font-medium text-ink-soft">
            <Sparkles className="h-3.5 w-3.5 text-terracotta" />
            AI for Indian schools — built on WhatsApp
          </span>
          <h1 className="mt-6 font-display text-5xl md:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.02] text-ink">
            Intelligence <br />
            <span className="italic text-terracotta">that guides.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink-soft leading-relaxed">
            Waynur is a warm, AI-powered school platform that keeps teachers, students and
            parents gently in sync — through the app they already open every day.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#pricing" className="inline-flex items-center gap-2 rounded-full bg-terracotta text-white px-6 py-3.5 text-sm font-medium shadow-md hover:bg-terracotta-deep transition">
              Book a demo <ArrowRight className="h-4 w-4" />
            </a>
            <Link to="/demo/teacher-whatsapp" className="inline-flex items-center gap-2 rounded-full border border-cream-deep bg-white px-6 py-3.5 text-sm font-medium hover:bg-cream-deep/40 transition">
              See it in action
            </Link>
          </div>
          <div className="mt-10 flex items-center gap-6 text-xs text-ink-soft">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-terracotta" />
              Parent-consent-first, built for India
            </div>
            <div className="h-4 w-px bg-cream-deep" />
            <div>Setup in under a week</div>
          </div>
        </div>
        <div className="relative">
          <div aria-hidden className="absolute -inset-6 rounded-[2rem] -z-10" style={{ background: 'linear-gradient(135deg, oklch(0.85 0.12 70 / 0.5), oklch(0.62 0.14 40 / 0.35))', filter: 'blur(30px)' }} />
          <img src={heroImg} alt="A teacher and two students sharing a tablet in warm classroom light" className="w-full h-[560px] object-cover rounded-[2rem] shadow-2xl border border-white/60" />
          <div className="absolute -bottom-6 -left-6 bg-white rounded-2xl shadow-xl border border-cream-deep p-4 max-w-[240px]">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> WhatsApp update sent
            </div>
            <p className="mt-2 text-sm text-ink leading-snug">"Aarav was present today and scored 9/10 in the Maths quiz. Well done!"</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProblemSolution() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <div className="max-w-2xl">
        <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">The everyday reality</p>
        <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight text-ink">
          Schools are doing beautiful work — with tools that get in the way.
        </h2>
      </div>
      <div className="mt-14 grid md:grid-cols-2 gap-6">
        <div className="rounded-3xl border border-cream-deep bg-white p-8">
          <p className="text-xs uppercase tracking-widest text-ink-soft">Today</p>
          <h3 className="mt-3 font-display text-2xl font-semibold text-ink">Paper registers. Missed messages. Anxious parents.</h3>
          <ul className="mt-6 space-y-3 text-ink-soft">
            <li className="flex gap-3"><span className="text-terracotta">•</span> Teachers lose evenings to attendance sheets and lesson plans.</li>
            <li className="flex gap-3"><span className="text-terracotta">•</span> Parents chase updates on WhatsApp groups and diaries.</li>
            <li className="flex gap-3"><span className="text-terracotta">•</span> Fees, payroll and buses live in five different spreadsheets.</li>
          </ul>
        </div>
        <div className="rounded-3xl p-8 bg-gradient-to-br from-terracotta to-terracotta-deep text-white shadow-xl">
          <p className="text-xs uppercase tracking-widest opacity-80">With Waynur</p>
          <h3 className="mt-3 font-display text-2xl font-semibold">One warm, quiet system that just… works.</h3>
          <ul className="mt-6 space-y-3 opacity-95">
            <li className="flex gap-3"><Heart className="h-5 w-5 shrink-0 mt-0.5" /> Every parent gets a personal WhatsApp update — no app to install.</li>
            <li className="flex gap-3"><Heart className="h-5 w-5 shrink-0 mt-0.5" /> Teachers save hours a week that used to go to paperwork.</li>
            <li className="flex gap-3"><Heart className="h-5 w-5 shrink-0 mt-0.5" /> Admins run attendance, fees, buses and payroll from one calm dashboard.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: CalendarCheck, title: 'Attendance, taken in seconds', body: 'Biometric or teacher-marked attendance. Parents know before assembly ends.' },
  { icon: MessageCircle, title: 'WhatsApp for every parent', body: 'Marks, homework, fee reminders — delivered warmly, in their language.' },
  { icon: Sparkles, title: 'AI tutor for every student', body: 'A patient guide that explains the \u2018why\u2019 behind every answer — safely.' },
  { icon: Fingerprint, title: 'Biometric & bus tracking', body: 'The gentle peace of mind of knowing your child boarded, arrived and is safe.' },
  { icon: Wallet, title: 'Fees & payroll, quietly done', body: 'Collections, receipts and staff payouts — automated and auditable.' },
  { icon: Bus, title: 'One dashboard for the whole school', body: 'Principals see everything. Teachers see their class. Parents see their child.' },
];

function Features() {
  return (
    <section id="features" className="bg-cream-deep/60 border-y border-cream-deep">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">What Waynur does</p>
          <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight text-ink">
            Everything a school needs. Nothing that gets in the way.
          </h2>
        </div>
        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="group rounded-3xl border border-cream-deep bg-white p-7 hover:shadow-lg hover:-translate-y-0.5 transition">
              <div className="h-11 w-11 rounded-2xl bg-terracotta/10 grid place-items-center text-terracotta-deep">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 font-display text-xl font-semibold text-ink">{f.title}</h3>
              <p className="mt-2 text-ink-soft leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Audiences() {
  return (
    <section id="audiences" className="mx-auto max-w-7xl px-6 py-24">
      <div className="max-w-2xl">
        <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">Two hearts, one platform</p>
        <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight text-ink">
          Built for the people who care most.
        </h2>
      </div>
      <div className="mt-14 grid lg:grid-cols-2 gap-6">
        <article className="rounded-3xl overflow-hidden border border-cream-deep bg-white">
          <img src={parentImg} alt="A parent smiling at her phone at home" loading="lazy" className="w-full h-72 object-cover" />
          <div className="p-8">
            <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">For parents</p>
            <h3 className="mt-2 font-display text-2xl font-semibold text-ink">Never miss a moment of their day.</h3>
            <p className="mt-3 text-ink-soft leading-relaxed">
              Attendance, marks, homework, fees, bus arrivals — arriving softly on WhatsApp, in the language you speak at home. No new app.
            </p>
          </div>
        </article>
        <article className="rounded-3xl overflow-hidden border border-cream-deep bg-white">
          <img src={schoolImg} alt="A principal standing in a bright school hallway" loading="lazy" className="w-full h-72 object-cover" />
          <div className="p-8">
            <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">For schools</p>
            <h3 className="mt-2 font-display text-2xl font-semibold text-ink">Run your school with grace, not spreadsheets.</h3>
            <p className="mt-3 text-ink-soft leading-relaxed">
              One calm dashboard for attendance, communication, fees, payroll and transport — plus an AI co-pilot that helps teachers plan lessons.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}

// NOTE for Pankaj: the "DPDP Act 2023 compliant" and similar claims below are
// carried over from the Lovable copy draft. Please confirm these are
// actually true of the current build before this page goes live publicly —
// compliance claims are the kind of thing that need to be accurate, not
// aspirational.
function Security() {
  const items = [
    { icon: ShieldCheck, title: "DPDP Act 2023 compliant", body: "Built to India's Digital Personal Data Protection framework." },
    { icon: MapPin, title: 'Data hosted in India', body: 'Student and parent data stays on Indian soil.' },
    { icon: Lock, title: 'Role-based access & audit logs', body: 'Every action is scoped to a role and traceable.' },
    { icon: UserCheck, title: 'Parent-consent-first', body: 'Nothing about a child leaves the school without an explicit consent trail.' },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <div className="max-w-2xl">
        <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">Trust & safety</p>
        <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight text-ink">
          Built for the most precious data a school holds.
        </h2>
      </div>
      <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {items.map((i) => (
          <div key={i.title} className="rounded-3xl border border-cream-deep bg-white p-6">
            <div className="h-10 w-10 rounded-2xl bg-terracotta/10 grid place-items-center text-terracotta-deep">
              <i.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-5 font-display text-lg font-semibold text-ink leading-snug">{i.title}</h3>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">{i.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const PLANS = [
  { name: 'Starter', tag: 'For single schools under 500 students', features: ['WhatsApp updates for every parent', 'Attendance, marks & homework', 'Email support'] },
  { name: 'Growth', tag: 'For growing schools & small chains', features: ['Everything in Starter', 'Fees, payroll & bus tracking', 'AI tutor + Accountant role', 'Priority WhatsApp support'], highlight: true },
  { name: 'District', tag: 'For groups, trusts & districts', features: ['Everything in Growth', 'Multi-school dashboards', 'Custom integrations', 'Dedicated support'] },
];

function Pricing() {
  return (
    <section id="pricing" className="bg-cream-deep/60 border-y border-cream-deep">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">Simple, per-student pricing</p>
          <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight text-ink">
            Priced so every Indian school can afford to feel modern.
          </h2>
          <p className="mt-4 text-ink-soft">Billed to the school. No parent ever pays.</p>
        </div>
        <div className="mt-14 grid md:grid-cols-3 gap-5">
          {PLANS.map((p) => (
            <div key={p.name} className={`rounded-3xl p-8 border transition ${p.highlight ? 'bg-gradient-to-br from-terracotta to-terracotta-deep text-white border-transparent shadow-xl' : 'bg-white border-cream-deep'}`}>
              <div className={`text-xs uppercase tracking-widest font-semibold ${p.highlight ? 'opacity-80' : 'text-ink-soft'}`}>{p.name}</div>
              <h3 className="mt-3 font-display text-2xl font-semibold">{p.tag}</h3>
              <ul className={`mt-6 space-y-3 text-sm ${p.highlight ? 'opacity-95' : 'text-ink-soft'}`}>
                {p.features.map((f) => (
                  <li key={f} className="flex gap-3">
                    <Check className={`h-4 w-4 mt-0.5 shrink-0 ${p.highlight ? '' : 'text-terracotta'}`} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-cream-deep bg-white px-8 py-6">
          <p className="text-ink-soft">Every plan starts with a free walkthrough tailored to your school.</p>
          <a href="#cta" className="inline-flex items-center gap-2 rounded-full bg-terracotta text-white px-5 py-2.5 text-sm font-medium hover:bg-terracotta-deep transition">
            Talk to us for a quote <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}

// NOTE for Pankaj: a few of these claims (SMS fallback, offline attendance
// sync, Tally/Zoho integrations) are carried over from the Lovable copy
// draft — please confirm each is actually built before publishing, or edit
// out the ones that aren't yet true.
const FAQS = [
  { q: 'How fast can we go live?', a: 'Most schools are onboarded within a week — including staff training, parent WhatsApp opt-in and importing your existing student records.' },
  { q: 'Do parents need to install an app?', a: 'No. Waynur sends every update over WhatsApp, which parents already open.' },
  { q: 'Who owns the data?', a: 'The school does — always. You can request a full export of your data at any time.' },
  { q: 'What happens if we decide to leave?', a: 'You get a full export of your records, no questions asked.' },
];

function FAQ() {
  return (
    <section id="faq" className="mx-auto max-w-4xl px-6 py-24">
      <div className="max-w-2xl">
        <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">Questions</p>
        <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight text-ink">Good to know.</h2>
      </div>
      <div className="mt-12 divide-y divide-cream-deep">
        {FAQS.map((f) => (
          <div key={f.q} className="py-6">
            <h3 className="font-display text-lg font-semibold text-ink">{f.q}</h3>
            <p className="mt-2 text-ink-soft leading-relaxed">{f.a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section id="cta" className="mx-auto max-w-7xl px-6 py-24">
      <div className="rounded-[2rem] bg-gradient-to-br from-terracotta to-terracotta-deep text-white p-10 md:p-16 text-center">
        <h2 className="font-display text-4xl md:text-5xl font-semibold tracking-tight">Ready to bring warmth back to school operations?</h2>
        <p className="mt-4 text-white/85 max-w-xl mx-auto">Set up your school in about 10 minutes — or talk to us first if you'd rather have a walkthrough.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/onboarding" className="inline-flex items-center gap-2 rounded-full bg-white text-terracotta-deep px-6 py-3.5 text-sm font-semibold shadow-md hover:scale-[1.03] transition-transform">
            Set up Waynur <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/login" className="inline-flex items-center gap-2 rounded-full border border-white/40 px-6 py-3.5 text-sm font-medium hover:bg-white/10 transition">
            School login
          </Link>
        </div>
      </div>
    </section>
  );
}


// Placeholder trust signal for investor/demo purposes — swap for real
// school names once there are real customers to name.
function Marquee() {
  const logos = ['School A', 'School B', 'School C', 'School D', 'School E', 'School F'];
  return (
    <div className="border-y border-cream-deep bg-cream-deep/60">
      <div className="mx-auto max-w-7xl px-6 py-6 flex flex-wrap items-center justify-between gap-y-3 gap-x-8 text-sm text-ink-soft">
        <span className="text-xs uppercase tracking-widest">Built for schools across India</span>
        {logos.map((l) => <span key={l} className="font-display italic">{l}</span>)}
      </div>
    </div>
  );
}

// Placeholder traction numbers for investor/demo purposes — these are
// illustrative, not real figures yet. Update once there's real usage data
// to show (the Super Admin Overview page already pulls real school/student
// counts from the database if you'd rather link to something live).
function Stats() {
  const stats = [
    { n: '—', l: 'Schools onboarded' },
    { n: '—', l: 'Students supported' },
    { n: '—', l: 'WhatsApp updates sent' },
    { n: '—', l: 'Parents engaged' },
  ];
  return (
    <section id="stats" className="mx-auto max-w-7xl px-6 py-24">
      <div className="rounded-[2rem] bg-ink text-cream p-10 md:p-14">
        <div className="grid md:grid-cols-[1fr_1.2fr] gap-10 items-end">
          <div>
            <p className="text-xs uppercase tracking-widest text-amber-warm font-semibold">Impact so far</p>
            <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight">
              Warmth, at the scale of an entire school system.
            </h2>
          </div>
          <p className="text-cream/70 leading-relaxed">
            We measure success in the quiet moments — a parent smiling at a message, a teacher
            leaving on time, a principal sleeping better. Real numbers land here as schools come on board.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((s) => (
            <div key={s.l} className="border-t border-cream/15 pt-6">
              <div className="font-display text-5xl font-semibold text-amber-warm">{s.n}</div>
              <div className="mt-2 text-sm text-cream/70">{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Placeholder quote for investor/demo purposes — swap for a real customer
// testimonial once there's a school willing to give one.
function Testimonial() {
  return (
    <section className="bg-cream-deep/60 border-y border-cream-deep">
      <div className="mx-auto max-w-4xl px-6 py-24 text-center">
        <blockquote className="font-display text-3xl md:text-4xl font-medium leading-snug tracking-tight text-ink">
          "For the first time, every parent in our school feels seen. Waynur didn't just digitise
          us — it made us kinder."
        </blockquote>
        <div className="mt-6 text-sm text-ink-soft">Illustrative quote — swap for a real one once you have it</div>
      </div>
    </section>
  );
}

// Real team, generic titles only — no fabricated career claims. Update the
// role lines with real bios whenever you're ready.
function Founders() {
  const team = [
    { initials: 'PT', name: 'Pankaj', role: 'Founder & Director' },
    { initials: 'N', name: 'Noor', role: 'Co-founder' },
    { initials: 'S', name: 'Sant', role: 'Engineering' },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-14 items-start">
        <div>
          <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">The people behind Waynur</p>
          <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight text-ink">
            Built by Wayne E Solutions.
          </h2>
          <p className="mt-5 text-ink-soft leading-relaxed">
            We're building the school system we wish our own children had — warm, WhatsApp-first,
            and quietly powered by AI.
          </p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {team.map((m) => (
            <div key={m.name} className="rounded-3xl border border-cream-deep bg-white p-6 text-center">
              <div className="mx-auto h-16 w-16 rounded-full bg-gradient-to-br from-terracotta to-terracotta-deep grid place-items-center text-white font-display text-xl font-semibold">
                {m.initials}
              </div>
              <div className="mt-4 font-display text-lg font-semibold text-ink">{m.name}</div>
              <div className="mt-1 text-xs text-ink-soft leading-relaxed">{m.role}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
export default function Index() {
  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <LandingNav />
      <Hero />
      <Marquee />
      <ProblemSolution />
      <Features />
      <Stats />
      <Audiences />
      <Testimonial />
      <Security />
      <Pricing />
      <Founders />
      <FAQ />
      <FinalCTA />
      <LandingFooter />
    </div>
  );
}
