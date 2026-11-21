import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { LandingNav, LandingFooter } from './LandingLayout';
import Seo from './Seo';
import { FEATURE_BY_SLUG, FEATURE_PAGES } from '../data/featurePages';
import { PRICING } from '../data/siteContent';

// Public feature pages: /features/<slug>. Copy lives in src/data/featurePages.js.
export default function FeaturePage({ slug: slugProp }) {
  const params = useParams();
  const slug = slugProp || params.slug;
  const page = FEATURE_BY_SLUG[slug];
  if (!page) return <Navigate to="/features" replace />;

  const others = FEATURE_PAGES.filter((p) => p.slug !== page.slug);

  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <Seo path={`/features/${page.slug}`} />
      <LandingNav />

      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-70"
          style={{ background: 'radial-gradient(1200px 600px at 90% -10%, oklch(0.9 0.09 75 / 0.55), transparent 60%), radial-gradient(900px 500px at -10% 30%, oklch(0.85 0.06 40 / 0.35), transparent 60%)' }}
        />
        <div className="mx-auto max-w-4xl px-6 pt-16 pb-10">
          <nav aria-label="Breadcrumb" className="text-xs text-ink-soft">
            <Link to="/" className="hover:text-terracotta">Home</Link>
            <span className="mx-2">/</span>
            <Link to="/features" className="hover:text-terracotta">Features</Link>
            <span className="mx-2">/</span>
            <span className="text-ink">{page.navLabel}</span>
          </nav>
          <h1 className="mt-4 font-display text-4xl md:text-5xl font-semibold tracking-tight text-ink">{page.h1}</h1>
          <p className="mt-5 text-lg text-ink-soft leading-relaxed">{page.lead}</p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-16 space-y-12">
        {page.sections.map((sec) => (
          <div key={sec.h2}>
            <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink">{sec.h2}</h2>
            {sec.text && <p className="mt-4 text-ink-soft leading-relaxed">{sec.text}</p>}
            {sec.items && (
              <ul className="mt-5 grid sm:grid-cols-2 gap-3">
                {sec.items.map((it) => (
                  <li key={it} className="flex gap-3 rounded-2xl border border-cream-deep bg-white px-4 py-3 text-ink-soft">
                    <Check className="h-4 w-4 mt-1 shrink-0 text-terracotta" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            )}
            {sec.steps && (
              <ol className="mt-5 space-y-3">
                {sec.steps.map((st, i) => (
                  <li key={st} className="flex gap-4 items-start">
                    <span className="grid place-items-center h-7 w-7 shrink-0 rounded-full bg-terracotta/10 text-terracotta-deep text-sm font-semibold">{i + 1}</span>
                    <span className="pt-0.5 text-ink-soft">{st}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}

        <div>
          <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink">Questions schools ask</h2>
          <div className="mt-6 divide-y divide-cream-deep rounded-3xl border border-cream-deep bg-white px-6">
            {page.faqs.map((f) => (
              <div key={f.q} className="py-5">
                <h3 className="font-display text-lg font-semibold text-ink">{f.q}</h3>
                <p className="mt-2 text-ink-soft leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-ink-soft">
            Looking for prices? See <Link to="/pricing" className="text-terracotta hover:underline">Waynur pricing</Link>.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-16">
        <div className="rounded-[2rem] bg-gradient-to-br from-terracotta to-terracotta-deep text-white p-10 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight">See it with your own school's data in a free demo.</h2>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <a href="/#cta" className="inline-flex items-center gap-2 rounded-full bg-white text-terracotta-deep px-6 py-3.5 text-sm font-semibold shadow-md hover:scale-[1.03] transition-transform">
              Book a free demo <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <p className="mt-5 text-white/85 text-sm">
            Questions? <a href="mailto:info@waynur.com" className="underline">info@waynur.com</a>
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-24">
        <h2 className="font-display text-xl font-semibold text-ink">More Waynur features</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {others.map((o) => (
            <li key={o.slug}>
              <Link to={`/features/${o.slug}`} className="inline-block rounded-full border border-cream-deep bg-white px-4 py-2 text-sm text-ink-soft hover:text-terracotta">
                {o.navLabel}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-xs text-ink-soft">Last updated: {PRICING.updated}</p>
      </section>

      <LandingFooter />
    </div>
  );
}
