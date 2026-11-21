import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, HelpCircle } from 'lucide-react';
import { LandingNav, LandingFooter } from './LandingLayout';
import Seo from './Seo';
import { PRICING, PRICE_SENTENCE, PRICING_FAQS } from '../data/siteContent';

export default function Pricing() {
  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <Seo path="/pricing" />
      <LandingNav />

      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-70"
          style={{ background: 'radial-gradient(1200px 600px at 90% -10%, oklch(0.9 0.09 75 / 0.55), transparent 60%), radial-gradient(900px 500px at -10% 30%, oklch(0.85 0.06 40 / 0.35), transparent 60%)' }}
        />
        <div className="mx-auto max-w-7xl px-6 pt-16 pb-10">
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-ink">
            Waynur pricing: simple, per student
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-soft leading-relaxed">
            {PRICE_SENTENCE} Waynur Core includes WhatsApp updates for parents, attendance, homework,
            marks, fees, payroll and transport. Waynur AI adds the AI tutor and AI help for teachers
            and the office. Every school starts with a free walkthrough.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="grid md:grid-cols-2 gap-5 max-w-5xl">
          {PRICING.plans.map((p) => (
            <div key={p.code} className={`rounded-3xl p-8 border transition ${p.highlight ? 'bg-gradient-to-br from-terracotta to-terracotta-deep text-white border-transparent shadow-xl' : 'bg-white border-cream-deep'}`}>
              <div className={`text-xs uppercase tracking-widest font-semibold ${p.highlight ? 'opacity-80' : 'text-ink-soft'}`}>{p.name}</div>
              <h2 className="mt-3 font-display text-3xl font-semibold">
                ₹{p.price} <span className="text-base font-medium opacity-80">per student / year, {PRICING.gstNote}</span>
              </h2>
              <p className={`mt-2 text-sm ${p.highlight ? 'opacity-90' : 'text-ink-soft'}`}>{p.bestFor}</p>
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
                  p.highlight ? 'bg-white text-terracotta-deep hover:scale-[1.03]' : 'bg-terracotta text-white hover:bg-terracotta-deep'
                }`}
              >
                Talk to us <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          ))}
        </div>

        <div className="mt-12 overflow-x-auto rounded-3xl border border-cream-deep bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Waynur plans and prices</caption>
            <thead className="bg-cream-deep/40 text-ink">
              <tr>
                <th scope="col" className="px-6 py-4 font-semibold">Plan</th>
                <th scope="col" className="px-6 py-4 font-semibold">Price per student</th>
                <th scope="col" className="px-6 py-4 font-semibold">Best for</th>
                <th scope="col" className="px-6 py-4 font-semibold">Billing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-deep text-ink-soft">
              {PRICING.plans.map((p) => (
                <tr key={p.code}>
                  <th scope="row" className="px-6 py-4 font-semibold text-ink">{p.name}</th>
                  <td className="px-6 py-4">₹{p.price} per year, {PRICING.gstNote}</td>
                  <td className="px-6 py-4">{p.bestFor}</td>
                  <td className="px-6 py-4">Yearly, billed to the school</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-cream-deep bg-white px-8 py-6">
          <p className="text-ink-soft">Every school starts with a free walkthrough tailored to your school.</p>
          <a href="#cta" className="inline-flex items-center gap-2 rounded-full bg-terracotta text-white px-5 py-2.5 text-sm font-medium hover:bg-terracotta-deep transition">
            Talk to us for a quote <ArrowRight className="h-4 w-4" />
          </a>
        </div>
        <p className="mt-6 text-xs text-ink-soft">Last updated: {PRICING.updated}</p>
      </section>

      <section className="bg-cream-deep/60 border-y border-cream-deep">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <div className="flex items-center gap-2 text-terracotta">
            <HelpCircle className="h-4 w-4" />
            <p className="text-xs uppercase tracking-widest font-semibold">Pricing questions</p>
          </div>
          <h2 className="mt-3 font-display text-3xl md:text-4xl font-semibold tracking-tight text-ink">School software pricing questions</h2>
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
