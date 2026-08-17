import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LandingNav, LandingFooter } from './LandingLayout';

// Real team, generic titles only — no fabricated career claims. Update the
// role lines with real bios whenever you're ready.
const TEAM = [
  { initials: 'PA', name: 'Pankaj Kumar', role: 'Founder & Director' },
  { initials: 'PV', name: 'Pavnoor Kaur', role: 'Co-founder' },
  { initials: 'PI', name: 'Piyush Mehndiratta', role: 'Marketing Head' },
  { initials: 'SU', name: 'Surbhi Mehndiratta', role: 'Graphic Designer' },
  { initials: 'BA', name: 'Baljeet Kaur', role: 'Graphic Designer' },
];

export default function Team() {
  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <LandingNav />
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-70"
          style={{ background: 'radial-gradient(1200px 600px at 90% -10%, oklch(0.9 0.09 75 / 0.55), transparent 60%), radial-gradient(900px 500px at -10% 30%, oklch(0.85 0.06 40 / 0.35), transparent 60%)' }}
        />
        <div className="mx-auto max-w-7xl px-6 pt-16 pb-14">
          <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">The people behind Waynur</p>
          <h1 className="mt-3 font-display text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-ink">
            Meet the team.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-soft leading-relaxed">
            Waynur is built by Wayne E Solutions — a small team based in Ludhiana, Punjab,
            building the school system we wish our own children had.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {TEAM.map((m) => (
            <div key={m.name} className="rounded-3xl border border-cream-deep bg-white p-8 text-center hover:shadow-lg transition">
              <div className="mx-auto h-20 w-20 rounded-full bg-gradient-to-br from-terracotta to-terracotta-deep grid place-items-center text-white font-display text-2xl font-semibold">
                {m.initials}
              </div>
              <div className="mt-5 font-display text-xl font-semibold text-ink">{m.name}</div>
              <div className="mt-1 text-sm text-ink-soft leading-relaxed">{m.role}</div>
            </div>
          ))}
        </div>

        <div className="mt-14 rounded-[2rem] bg-gradient-to-br from-terracotta to-terracotta-deep text-white p-10 md:p-14 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">Want to talk to us directly?</h2>
          <p className="mt-3 text-white/85 max-w-xl mx-auto">We're happy to walk you through Waynur, plan by plan.</p>
          <Link to="/pricing" className="mt-7 inline-flex items-center gap-2 rounded-full bg-white text-terracotta-deep px-6 py-3.5 text-sm font-semibold shadow-md hover:scale-[1.03] transition-transform">
            See pricing <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
      <LandingFooter />
    </div>
  );
}
