import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { LandingNav, LandingFooter } from './LandingLayout';
import Seo from './Seo';
import { FAQ_GROUPS, PRICING } from '../data/siteContent';

export default function Faq() {
  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <Seo path="/faq" />
      <LandingNav />

      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-70"
          style={{ background: 'radial-gradient(1200px 600px at 90% -10%, oklch(0.9 0.09 75 / 0.55), transparent 60%), radial-gradient(900px 500px at -10% 30%, oklch(0.85 0.06 40 / 0.35), transparent 60%)' }}
        />
        <div className="mx-auto max-w-7xl px-6 pt-16 pb-10">
          <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">Questions</p>
          <h1 className="mt-3 font-display text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-ink">
            Questions schools ask about Waynur
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-soft leading-relaxed">
            Waynur is AI school management software for private schools in India, built around
            WhatsApp. Here are the questions principals and school owners ask before switching,
            grouped by topic.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-24 space-y-14">
        {FAQ_GROUPS.map((group) => (
          <div key={group.title}>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">{group.title}</h2>
            <div className="mt-6 divide-y divide-cream-deep rounded-3xl border border-cream-deep bg-white px-6">
              {group.items.map((f) => (
                <div key={f.q} className="py-6">
                  <h3 className="font-display text-lg font-semibold text-ink">{f.q}</h3>
                  <p className="mt-2 text-ink-soft leading-relaxed">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs text-ink-soft">Last updated: {PRICING.updated}</p>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="rounded-[2rem] bg-gradient-to-br from-terracotta to-terracotta-deep text-white p-10 md:p-16 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">Still have a question?</h2>
          <p className="mt-3 text-white/85 max-w-xl mx-auto">We're happy to walk you through Waynur, plan by plan.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/onboarding" className="inline-flex items-center gap-2 rounded-full bg-white text-terracotta-deep px-6 py-3.5 text-sm font-semibold shadow-md hover:scale-[1.03] transition-transform">
              Set up Waynur <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/legal/contact-grievance-information" className="inline-flex items-center gap-2 rounded-full border border-white/40 px-6 py-3.5 text-sm font-medium hover:bg-white/10 transition">
              Contact us
            </Link>
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
