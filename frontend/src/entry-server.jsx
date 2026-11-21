// Build-time pre-render of the PUBLIC marketing pages (see scripts/prerender.mjs).
// Bots like OAI-SearchBot, ClaudeBot, PerplexityBot and often Bing don't run
// JavaScript, so each public URL must ship its own title, meta, H1, body text
// and JSON-LD in the HTML. The app itself (logins, dashboards) stays a normal SPA.
import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import Index from './components/Index';
import Features from './components/Features';
import FeaturePage from './components/FeaturePage';
import Pricing from './components/Pricing';
import Faq from './components/Faq';
import Team from './components/Team';
import Legal from './components/Legal';
import TeacherWhatsAppDemo from './components/TeacherWhatsAppDemo';
import { FEATURE_PAGES } from './data/featurePages';
import { LEGAL_SECTIONS } from './data/legalContent';

export const ROUTES = [
  '/',
  '/features',
  ...FEATURE_PAGES.map((p) => `/features/${p.slug}`),
  '/pricing',
  '/faq',
  '/team',
  '/legal',
  ...LEGAL_SECTIONS.map((s) => `/legal/${s.id}`),
  '/demo/teacher-whatsapp',
];

export function render(url) {
  const helmetContext = {};
  const html = renderToString(
    <HelmetProvider context={helmetContext}>
      <StaticRouter location={url}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/features" element={<Features />} />
          <Route path="/features/:slug" element={<FeaturePage />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/team" element={<Team />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/legal/:sectionId" element={<Legal />} />
          <Route path="/demo/teacher-whatsapp" element={<TeacherWhatsAppDemo />} />
        </Routes>
      </StaticRouter>
    </HelmetProvider>
  );
  const { helmet } = helmetContext;
  const head = helmet
    ? [helmet.title, helmet.meta, helmet.link, helmet.script].map((h) => h.toString()).join('\n')
    : '';
  return { html, head };
}
