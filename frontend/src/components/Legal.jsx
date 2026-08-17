import React, { useEffect, useState } from 'react';
import { LandingNav, LandingFooter } from './LandingLayout';
import { LEGAL_SECTIONS } from '../data/legalContent';

function Block({ block }) {
  if (block.type === 'ul') {
    return (
      <ul className="mt-3 space-y-2 text-ink-soft leading-relaxed list-disc pl-5">
        {block.items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    );
  }
  if (block.type === 'note') {
    return (
      <p className="mt-3 text-sm italic text-ink-soft/80 border-l-2 border-terracotta/40 pl-4">
        {block.text}
      </p>
    );
  }
  return <p className="mt-3 text-ink-soft leading-relaxed">{block.text}</p>;
}

function LegalSection({ section }) {
  return (
    <section id={section.id} className="scroll-mt-28 py-10 border-b border-cream-deep last:border-0">
      <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink">{section.title}</h2>
      {section.lastUpdated && (
        <p className="mt-1 text-xs text-ink-soft/70 italic">Last updated: {section.lastUpdated}</p>
      )}
      <div className="mt-6 space-y-8">
        {section.subsections.map((sub, i) => (
          <div key={i}>
            {sub.title && (
              <h3 className="font-display text-lg font-semibold text-ink">{sub.title}</h3>
            )}
            {sub.blocks.map((b, j) => <Block key={j} block={b} />)}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Legal() {
  const [active, setActive] = useState(LEGAL_SECTIONS[0]?.id);

  useEffect(() => {
    if (window.location.hash) {
      const id = window.location.hash.replace('#', '');
      const el = document.getElementById(id);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
        setActive(id);
      }
    }
  }, []);

  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <LandingNav />

      <section className="mx-auto max-w-7xl px-6 pt-16 pb-8">
        <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">Legal</p>
        <h1 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight text-ink">
          Waynur legal pages.
        </h1>
        <p className="mt-4 max-w-2xl text-ink-soft leading-relaxed">
          Terms, privacy, refunds, cookies, acceptable use, our SaaS agreement summary, and how to
          reach us — all in one place. Operated by Wayne E Solutions, Ludhiana, Punjab, India.
        </p>
        <p className="mt-3 max-w-2xl text-sm text-ink-soft/70 italic">
          Draft for legal review — some details below (dates, contact addresses) are placeholders
          pending final sign-off.
        </p>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-24 grid lg:grid-cols-[240px_1fr] gap-10">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1">
            {LEGAL_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={() => setActive(s.id)}
                className={`block rounded-xl px-3 py-2 text-sm transition ${
                  active === s.id
                    ? 'bg-terracotta text-white font-medium'
                    : 'text-ink-soft hover:bg-cream-deep/60 hover:text-ink'
                }`}
              >
                {s.title}
              </a>
            ))}
          </nav>
        </aside>

        <div className="rounded-3xl border border-cream-deep bg-white px-6 md:px-10">
          {LEGAL_SECTIONS.map((s) => (
            <LegalSection key={s.id} section={s} />
          ))}
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
