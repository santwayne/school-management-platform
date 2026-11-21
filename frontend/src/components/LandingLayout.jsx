import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, Instagram, ChevronDown } from 'lucide-react';
import { FEATURE_PAGES } from '../data/featurePages';
import logoFull from '../assets/waynur-logo.png';

const NAV_LINKS = [
  { label: 'Features', to: '/features' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Blog', to: '/blog' },
  { label: 'FAQ', to: '/faq' },
  { label: 'Team', to: '/team' },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 bg-cream/85 backdrop-blur border-b border-cream-deep/60">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <img src={logoFull} alt="Waynur logo" className="h-10 w-auto object-contain" />
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm text-ink-soft">
          {NAV_LINKS.map((l) => (l.label === 'Features' ? (
            <div key={l.label} className="relative group">
              <Link to={l.to} className="inline-flex items-center gap-1 hover:text-ink transition">
                {l.label} <ChevronDown className="h-3.5 w-3.5" />
              </Link>
              {/* Plain links in the HTML so crawlers can reach every feature page. */}
              <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition absolute left-0 top-full pt-3 z-40">
                <ul className="w-64 rounded-2xl border border-cream-deep bg-white p-2 shadow-lg">
                  {FEATURE_PAGES.map((f) => (
                    <li key={f.slug}>
                      <Link to={`/features/${f.slug}`} className="block rounded-xl px-3 py-2 hover:bg-cream-deep/50 hover:text-ink">{f.navLabel}</Link>
                    </li>
                  ))}
                  <li><Link to="/features" className="block rounded-xl px-3 py-2 font-medium text-terracotta hover:bg-cream-deep/50">All features</Link></li>
                </ul>
              </div>
            </div>
          ) : (
            <Link key={l.label} to={l.to} className="hover:text-ink transition">
              {l.label}
            </Link>
          )))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium text-ink-soft hover:text-ink transition">School login</Link>
          <Link to="/onboarding" className="inline-flex items-center gap-1.5 rounded-full bg-terracotta text-white px-4 py-2 text-sm font-medium hover:bg-terracotta-deep transition">
            Set up Waynur
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="md:hidden grid place-items-center h-10 w-10 rounded-full border border-cream-deep bg-white text-ink"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-cream-deep bg-cream">
          <nav className="mx-auto max-w-7xl px-6 py-4 flex flex-col gap-1 text-sm">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.label}
                to={l.to}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-3 text-ink-soft hover:bg-cream-deep/60 hover:text-ink transition"
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-2 pt-3 border-t border-cream-deep flex flex-col gap-2">
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-3 text-sm font-medium text-ink-soft hover:bg-cream-deep/60 hover:text-ink transition"
              >
                School login
              </Link>
              <Link
                to="/onboarding"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center gap-1.5 rounded-full bg-terracotta text-white px-4 py-3 text-sm font-medium hover:bg-terracotta-deep transition"
              >
                Set up Waynur
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

function FooterLink({ label, to, href, external }) {
  const cls = 'hover:text-terracotta transition';
  if (to) return <Link to={to} className={cls}>{label}</Link>;
  return (
    <a
      href={href || '#'}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cls}
    >
      {label}
    </a>
  );
}

function FooterCol({ title, links }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-ink-soft font-semibold">{title}</div>
      <ul className="mt-4 space-y-2 text-sm">
        {links.map((l) => <li key={l.label}><FooterLink {...l} /></li>)}
      </ul>
    </div>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-cream-deep bg-cream-deep/40">
      <div className="mx-auto max-w-7xl px-6 py-14 grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <img src={logoFull} alt="Waynur logo" className="h-10 w-auto object-contain" />
          </div>
          <p className="mt-4 text-sm text-ink-soft max-w-xs leading-relaxed">
            Intelligence that guides — an AI school platform built with warmth, for Indian schools.
          </p>
          <div className="mt-4 space-y-1.5 text-sm text-ink-soft">
            <a href="mailto:info@waynur.com" className="block hover:text-terracotta transition">info@waynur.com</a>
            <a href="https://www.instagram.com/waynur___/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-terracotta transition">
              <Instagram className="h-4 w-4" /> @waynur___
            </a>
            <div>Ludhiana, Punjab, India</div>
          </div>
        </div>
        <FooterCol
          title="Product"
          links={[
            { label: 'Features', to: '/features' },
            { label: 'Pricing', to: '/pricing' },
            { label: 'FAQ', to: '/faq' },
            { label: 'Blog', to: '/blog' },
            { label: 'School login', to: '/login' },
          ]}
        />
        <FooterCol
          title="Features"
          links={FEATURE_PAGES.map((f) => ({ label: f.navLabel, to: `/features/${f.slug}` }))}
        />
        <FooterCol
          title="Company"
          links={[
            { label: 'Team', to: '/team' },
            { label: 'Contact', to: '/legal/contact-grievance-information' },
          ]}
        />
        <FooterCol
          title="Trust"
          links={[
            { label: 'Terms & Conditions', to: '/legal/terms-conditions' },
            { label: 'Privacy Policy', to: '/legal/privacy-policy' },
            { label: 'Refund Policy', to: '/legal/refund-cancellation-policy' },
            { label: 'Cookie Policy', to: '/legal/cookie-policy' },
          ]}
        />
      </div>
      <div className="border-t border-cream-deep">
        <div className="mx-auto max-w-7xl px-6 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-soft">
          <div>© {new Date().getFullYear()} Waynur · info@waynur.com · Ludhiana, Punjab, India</div>
          <div>
            Made by{' '}
            <a href="https://wayneesolutions.com" target="_blank" rel="noopener" className="hover:text-terracotta underline">Wayne E Solutions</a>
          </div>
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
