import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import logoFull from '../assets/waynur-logo.png';

const NAV_LINKS = [
  { label: 'Features', to: '/features' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'FAQ', to: '/faq' },
  { label: 'Team', to: '/team' },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 bg-cream/85 backdrop-blur border-b border-cream-deep/60">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <img src={logoFull} alt="Waynur" className="h-10 w-auto object-contain" />
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm text-ink-soft">
          {NAV_LINKS.map((l) => (
            <Link key={l.label} to={l.to} target="_blank" rel="noopener noreferrer" className="hover:text-ink transition">
              {l.label}
            </Link>
          ))}
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
                target="_blank"
                rel="noopener noreferrer"
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
      <div className="mx-auto max-w-7xl px-6 py-14 grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <img src={logoFull} alt="Waynur logo" className="h-10 w-auto object-contain" />
          </div>
          <p className="mt-4 text-sm text-ink-soft max-w-xs leading-relaxed">
            Intelligence that guides — an AI school platform built with warmth, for Indian schools.
          </p>
        </div>
        <FooterCol
          title="Product"
          links={[
            { label: 'Features', to: '/features' },
            { label: 'For schools', href: '/#audiences', external: true },
            { label: 'For parents', href: '/#audiences', external: true },
            { label: 'Pricing', to: '/pricing' },
            { label: 'FAQ', to: '/faq' },
            { label: 'School login', to: '/login' },
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            { label: 'Team', to: '/team' },
            { label: 'Contact', to: '/legal#contact-grievance-information' },
          ]}
        />
        <FooterCol
          title="Trust"
          links={[
            { label: 'Terms & Conditions', to: '/legal#terms-conditions' },
            { label: 'Privacy Policy', to: '/legal#privacy-policy' },
            { label: 'Refund Policy', to: '/legal#refund-cancellation-policy' },
            { label: 'Cookie Policy', to: '/legal#cookie-policy' },
          ]}
        />
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
