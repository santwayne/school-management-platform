import React from 'react';
import { Helmet } from 'react-helmet-async';
import SEO from '../data/seoHead';

// Per-page <head> tags (title, description, canonical, Open Graph, Twitter, JSON-LD).
// `path` must be a key in src/data/seoHead.js, e.g. "/", "/features", "/legal".
export default function Seo({ path }) {
  const d = SEO[path];
  if (!d) return null;
  return (
    <Helmet>
      <title>{d.title}</title>
      <meta name="description" content={d.description} />
      <link rel="canonical" href={d.canonical} />
      <meta name="robots" content={d.robots} />
      <meta property="og:type" content={d.ogType} />
      <meta property="og:site_name" content={d.ogSiteName} />
      <meta property="og:title" content={d.ogTitle} />
      <meta property="og:description" content={d.ogDescription} />
      <meta property="og:url" content={d.ogUrl} />
      <meta property="og:image" content={d.ogImage} />
      <meta name="twitter:card" content={d.twitterCard} />
      <script type="application/ld+json">{JSON.stringify(d.jsonLd)}</script>
    </Helmet>
  );
}
