import React from 'react';
import { Link } from 'react-router-dom';

export function LandingNav() {
  return (
    <header className="sticky top-0 z-30 bg-cream/85 backdrop-blur border-b border-cream-deep/60">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid place-items-center h-8 w-8 rounded-full bg-terracotta text-white font-display font-semibold">W</span>
          <span className="font-display text-lg font-semibold text-ink">Waynur</span>
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-sm text-ink-soft">
          <a href="/#features" className="hover:text-ink transition">Features</a>
          <a href="/#pricing" className="hover:text-ink transition">Pricing</a>
          <a href="/#faq" className="hover:text-ink transition">FAQ</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium text-ink-soft hover:text-ink transition">School login</Link>
          <Link to="/onboarding" className="inline-flex items-center gap-1.5 rounded-full bg-terracotta text-white px-4 py-2 text-sm font-medium hover:bg-terracotta-deep transition">
            Set up Waynur
          </Link>
        </div>
      </div>
    </header>
  );
}

function FooterCol({ title, links }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-ink-soft font-semibold">{title}</div>
      <ul className="mt-4 space-y-2 text-sm">
        {links.map((l) => <li key={l}><a href="#" className="hover:text-terracotta transition">{l}</a></li>)}
      </ul>
    </div>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-cream-deep bg-cream-deep/40">
      <div className="mx-auto max-w-7xl px-6 py-14 grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid place-items-center h-9 w-9 rounded-full bg-terracotta text-white font-display font-semibold">W</span>
            <span className="font-display text-xl font-semibold text-ink">Waynur</span>
          </div>
          <p className="mt-4 text-sm text-ink-soft max-w-xs leading-relaxed">
            Intelligence that guides — an AI school platform built with warmth, for Indian schools.
          </p>
        </div>
        <FooterCol title="Product" links={['Features', 'For schools', 'For parents', 'Pricing', 'School login']} />
        <FooterCol title="Company" links={['About', 'Contact']} />
        <FooterCol title="Trust" links={['Privacy', 'Security']} />
      </div>
      <div className="border-t border-cream-deep">
        <div className="mx-auto max-w-7xl px-6 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-soft">
          <div>© {new Date().getFullYear()} Wayne E Solutions. Made with care in India.</div>
        </div>
      </div>
    </footer>
  );
}

export default function LandingLayout({ children }) {
  return (
    <div className="min-h-screen bg-cream text-ink font-sans flex flex-col">
      <LandingNav />
      <main className="flex-1 flex flex-col">
        {children}
      </main>
      <LandingFooter />
    </div>
  );
}
