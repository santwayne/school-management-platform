import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, HelpCircle } from 'lucide-react';
import { LandingNav, LandingFooter } from './LandingLayout';

const PLANS = [
  {
    name: 'Starter',
    tag: 'For single schools under 500 students',
    features: [
      'WhatsApp updates for every parent',
      'Attendance, marks & homework',
      'Student & staff records',
      'Email support',
    ],
  },
  {
    name: 'Growth',
    tag: 'For growing schools & small chains',
    highlight: true,
    features: [
      'Everything in Starter',
      'Fees, payroll & bus tracking',
      'AI tutor + Accountant role',
      'Lesson plans & syllabus tracking',
      'Priority WhatsApp support',
    ],
  },
  {
    name: 'District',
    tag: 'For groups, trusts & districts',
    features: [
      'Everything in Growth',
      'Multi-school dashboards',
      'AI-assisted grading',
      'Custom integrations',
      'Dedicated support',
    ],
  },
];

const PRICING_FAQS = [
  { q: 'How is pricing calculated?', a: 'Per-student, billed to the school — no parent, teacher, or student ever pays anything directly.' },
  { q: 'Is there a setup fee?', a: 'Onboarding and data migration are quoted per school based on your current records and how many systems we\u2019re replacing.' },
  { q: 'Can we switch plans later?', a: 'Yes. Upgrades take effect immediately; downgrades apply from the next billing cycle.' },
  { q: 'Do you offer annual billing?', a: 'Yes, both monthly and annual billing are available — talk to us for annual pricing.' },
];

export default function Pricing() {
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
          <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">Simple, per-student pricing</p>
          <h1 className="mt-3 font-display text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-ink">
            Priced so every Indian school can afford to feel modern.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-soft leading-relaxed">
            Billed to the school, per student, per month. No parent ever pays. No hidden per-message
            WhatsApp charges — they're built into the plan.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="grid md:grid-cols-3 gap-5">
          {PLANS.map((p) => (
            <div key={p.name} className={`rounded-3xl p-8 border transition ${p.highlight ? 'bg-gradient-to-br from-terracotta to-terracotta-deep text-white border-transparent shadow-xl md:-translate-y-2' : 'bg-white border-cream-deep'}`}>
              {p.highlight && (
                <div className="inline-flex items-center rounded-full bg-white/20 px-3 py-1 text-xs font-semibold mb-4">Most popular</div>
              )}
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
              <a
                href="#cta"
                className={`mt-8 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition ${
                  p.highlight
                    ? 'bg-white text-terracotta-deep hover:scale-[1.03]'
                    : 'bg-terracotta text-white hover:bg-terracotta-deep'
                }`}
              >
                Talk to us <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-cream-deep bg-white px-8 py-6">
          <p className="text-ink-soft">Every plan starts with a free walkthrough tailored to your school.</p>
          <a href="#cta" className="inline-flex items-center gap-2 rounded-full bg-terracotta text-white px-5 py-2.5 text-sm font-medium hover:bg-terracotta-deep transition">
            Talk to us for a quote <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      <section className="bg-cream-deep/60 border-y border-cream-deep">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <div className="flex items-center gap-2 text-terracotta">
            <HelpCircle className="h-4 w-4" />
            <p className="text-xs uppercase tracking-widest font-semibold">Pricing questions</p>
          </div>
          <h2 className="mt-3 font-display text-3xl md:text-4xl font-semibold tracking-tight text-ink">Good to know.</h2>
          <div className="mt-10 divide-y divide-cream-deep">
            {PRICING_FAQS.map((f) => (
              <div key={f.q} className="py-6">
                <h3 className="font-display text-lg font-semibold text-ink">{f.q}</h3>
                <p className="mt-2 text-ink-soft leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

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

      <LandingFooter />
    </div>
  );
}
