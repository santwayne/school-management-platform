import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';
import { escapeXml } from '../services/blogContent.js';

// ------------------------------------------------------------------
// Server-rendered public pages that change without a frontend rebuild.
//   GET /blog            blog list, real HTML
//   GET /blog/:slug      the article in the HTML (title, meta, H1, body,
//                        BlogPosting + BreadcrumbList JSON-LD); unknown
//                        slug -> HTTP 404, renamed slug -> 301
//   GET /sitemap.xml     every public URL (static pages, /features/*, posts)
//
// Why: OAI-SearchBot (ChatGPT), ClaudeBot / Claude-SearchBot, PerplexityBot
// and often Bing do not run JavaScript. Before this, every URL sent them the
// same empty SPA shell. nginx proxies these paths here (deploy/nginx-waynur.conf);
// the React app still boots on top of the HTML for real visitors.
//
// The other public pages (/, /features, /pricing, /faq ...) are pre-rendered
// at build time by frontend/scripts/prerender.mjs.
// ------------------------------------------------------------------

const router = express.Router();
export default router;

const SITE = (process.env.PUBLIC_SITE_URL || 'https://waynur.com').replace(/\/+$/, '');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_FRONTEND = path.resolve(__dirname, '../../frontend');

// Where the built frontend lives. nginx serves /var/www/waynur; fall back to
// the repo's own build for local runs.
const DIST_CANDIDATES = [process.env.FRONTEND_DIST, '/var/www/waynur', path.join(REPO_FRONTEND, 'dist')].filter(Boolean);

const e = (s) => escapeXml(String(s ?? ''));
// JSON inside <script> must not be able to close the tag.
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// ---------- Shared copy from the frontend (single source of truth) ----------

let shared = null;
async function loadShared() {
  if (shared) return shared;
  try {
    const [fp, sc] = await Promise.all([
      import(path.join(REPO_FRONTEND, 'src/data/featurePages.js')),
      import(path.join(REPO_FRONTEND, 'src/data/siteContent.js')),
    ]);
    shared = { FEATURE_PAGES: fp.FEATURE_PAGES, featureForPost: fp.featureForPost, BLOG_META: sc.BLOG_META };
  } catch (err) {
    console.error('site.js: could not load frontend/src/data — feature links and blog meta use fallbacks:', err.message);
    shared = {
      FEATURE_PAGES: [],
      featureForPost: () => null,
      BLOG_META: { title: 'Waynur Blog', description: 'Guides for school principals and owners in India.', h1: 'The Waynur blog' },
    };
  }
  return shared;
}

// ---------- HTML template (the built SPA shell) ----------

let tpl = { file: null, mtime: 0, html: null };
function template() {
  for (const dir of DIST_CANDIDATES) {
    for (const name of ['spa.html', 'index.html']) {
      const file = path.join(dir, name);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (tpl.file !== file || tpl.mtime !== st.mtimeMs) {
        tpl = { file, mtime: st.mtimeMs, html: fs.readFileSync(file, 'utf8') };
      }
      return tpl.html;
    }
  }
  // No build on this machine: minimal shell so crawlers still get content.
  return '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Waynur</title></head><body><div id="root"></div></body></html>';
}

function page({ head, body, boot }) {
  let html = template().replace(/<title>[\s\S]*?<\/title>\s*/, '');
  // data-rh lets react-helmet-async replace these tags once React boots, so
  // the browser never ends up with two titles / canonicals.
  html = html.replace('</head>', `${head}\n</head>`);
  const bootScript = boot ? `<script>window.__WAYNUR_BLOG__=${jsonForScript(boot)};</script>` : '';
  return html.replace('<div id="root"></div>', `<div id="root">${body}</div>${bootScript}`);
}

function headTags({ title, description, canonical, ogType = 'website', image, robots = 'index, follow', jsonLd }) {
  const img = image || `${SITE}/og-image.jpg`;
  return [
    `<title data-rh="true">${e(title)}</title>`,
    `<meta data-rh="true" name="description" content="${e(description)}"/>`,
    `<meta data-rh="true" name="robots" content="${e(robots)}"/>`,
    canonical ? `<link data-rh="true" rel="canonical" href="${e(canonical)}"/>` : '',
    `<meta data-rh="true" property="og:type" content="${e(ogType)}"/>`,
    '<meta data-rh="true" property="og:site_name" content="Waynur"/>',
    `<meta data-rh="true" property="og:title" content="${e(title)}"/>`,
    `<meta data-rh="true" property="og:description" content="${e(description)}"/>`,
    canonical ? `<meta data-rh="true" property="og:url" content="${e(canonical)}"/>` : '',
    `<meta data-rh="true" property="og:image" content="${e(img)}"/>`,
    '<meta data-rh="true" name="twitter:card" content="summary_large_image"/>',
    jsonLd ? `<script data-rh="true" type="application/ld+json">${jsonForScript(jsonLd)}</script>` : '',
  ].filter(Boolean).join('\n');
}

const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const isoDate = (d) => new Date(d).toISOString();

function chrome(inner, featurePages) {
  const nav = [['Features', '/features'], ['Pricing', '/pricing'], ['Blog', '/blog'], ['FAQ', '/faq'], ['Team', '/team']]
    .map(([l, h]) => `<a href="${h}" class="hover:text-ink">${l}</a>`).join('');
  const features = featurePages.map((f) => `<li><a href="/features/${e(f.slug)}" class="hover:text-terracotta">${e(f.navLabel)}</a></li>`).join('');
  return `<div class="min-h-screen bg-cream text-ink font-sans flex flex-col">
<header class="border-b border-cream-deep/60"><div class="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between"><a href="/" class="font-display text-xl font-semibold">Waynur</a><nav class="hidden md:flex items-center gap-8 text-sm text-ink-soft">${nav}</nav></div></header>
<main class="flex-1">${inner}</main>
<footer class="border-t border-cream-deep bg-cream-deep/40"><div class="mx-auto max-w-7xl px-6 py-10 grid gap-8 md:grid-cols-3 text-sm text-ink-soft">
<div><p>Waynur · <a href="mailto:info@waynur.com">info@waynur.com</a> · Ludhiana, Punjab, India</p><p class="mt-2">Made by <a href="https://wayneesolutions.com" rel="noopener">Wayne E Solutions</a></p></div>
<ul class="space-y-1"><li><a href="/features">Features</a></li><li><a href="/pricing">Pricing</a></li><li><a href="/faq">FAQ</a></li><li><a href="/blog">Blog</a></li><li><a href="/team">Team</a></li></ul>
<ul class="space-y-1">${features}</ul>
</div></footer></div>`;
}

// ---------- Cache (10 min; cleared when a post is saved in blog-admin) ----------

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();
export function clearSiteCache() { cache.clear(); }
async function cached(key, build) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await build();
  cache.set(key, { value, until: Date.now() + CACHE_TTL_MS });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

function send(res, { status = 200, html }) {
  res.status(status);
  res.set('Cache-Control', status === 200 ? 'public, max-age=60' : 'no-cache');
  res.type('html').send(html);
}

// ---------- Redirects for renamed / retired slugs ----------

let staticRedirects = {};
try {
  staticRedirects = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/blogRedirects.json'), 'utf8'));
} catch { /* optional file */ }

async function redirectFor(slug) {
  try {
    const r = await pool.query('SELECT new_slug FROM blog_slug_redirects WHERE old_slug = $1', [slug]);
    if (r.rowCount) return r.rows[0].new_slug;
  } catch { /* table not created yet */ }
  return staticRedirects[slug] || null;
}

// ---------- /blog ----------

router.get(['/blog', '/blog/'], async (req, res) => {
  // Tag / page views are rare; let the SPA handle them (still 200 + shell).
  const tag = String(req.query.tag || '').trim();
  const pageNo = Math.max(parseInt(req.query.page, 10) || 1, 1);
  try {
    const { FEATURE_PAGES, BLOG_META } = await loadShared();
    const html = await cached(`list:${tag}:${pageNo}`, async () => {
      const limit = 12;
      const where = tag ? 'WHERE EXISTS (SELECT 1 FROM unnest(tags) t WHERE lower(t) = lower($1))' : '';
      const params = tag ? [tag] : [];
      const [rows, count] = await Promise.all([
        pool.query(
          `SELECT slug, title, meta_description, tags, image_url, created_at, updated_at
           FROM blog_posts ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, (pageNo - 1) * limit]
        ),
        pool.query(`SELECT COUNT(*)::int AS total FROM blog_posts ${where}`, params),
      ]);
      const posts = rows.rows;
      const items = posts.map((p) => `<article class="py-6 border-b border-cream-deep">
<time datetime="${e(isoDate(p.created_at))}" class="text-sm text-ink-soft">${e(fmtDate(p.created_at))}</time>
<h2 class="mt-2 font-display text-2xl font-semibold"><a href="/blog/${e(p.slug)}">${e(p.title)}</a></h2>
${p.meta_description ? `<p class="mt-2 text-ink-soft">${e(p.meta_description)}</p>` : ''}
</article>`).join('\n');
      const canonical = tag || pageNo > 1 ? null : `${SITE}/blog`;
      const head = headTags({
        title: tag ? `${tag} | Waynur Blog` : BLOG_META.title,
        description: BLOG_META.description,
        canonical: canonical || `${SITE}/blog`,
        robots: tag || pageNo > 1 ? 'noindex, follow' : 'index, follow',
        jsonLd: {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Blog',
              name: 'Waynur Blog',
              url: `${SITE}/blog`,
              publisher: { '@id': `${SITE}/#organization` },
              blogPost: posts.map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE}/blog/${p.slug}`, datePublished: isoDate(p.created_at), dateModified: isoDate(p.updated_at) })),
            },
            { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` }, { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog` }] },
          ],
        },
      });
      const body = chrome(`<div class="mx-auto max-w-5xl px-6 pt-14 pb-20">
<h1 class="font-display text-4xl md:text-5xl font-semibold tracking-tight">${tag ? `Posts on ${e(tag)}` : e(BLOG_META.h1)}</h1>
<p class="mt-4 max-w-2xl text-lg text-ink-soft">${e(BLOG_META.description)}</p>
<div class="mt-10">${items || '<p>No posts yet.</p>'}</div>
</div>`, FEATURE_PAGES);
      const boot = !tag && pageNo === 1 ? { list: { posts, total: count.rows[0].total } } : null;
      return page({ head, body, boot });
    });
    send(res, { html });
  } catch (err) {
    console.error('SSR /blog failed:', err);
    // Never show "no posts" to a crawler because of a DB blip: 503 = try later.
    res.set('Retry-After', '120');
    send(res, { status: 503, html: page({ head: headTags({ title: 'Waynur Blog', description: 'The blog is temporarily unavailable.', robots: 'noindex' }), body: '' }) });
  }
});

// ---------- /blog/:slug ----------

router.get('/blog/:slug', async (req, res) => {
  const raw = String(req.params.slug || '');
  const slug = raw.toLowerCase().replace(/\/+$/, '');
  if (raw !== slug) return res.redirect(301, `/blog/${encodeURIComponent(slug)}`);
  try {
    const { FEATURE_PAGES, featureForPost } = await loadShared();
    const result = await cached(`post:${slug}`, async () => {
      const r = await pool.query(
        `SELECT slug, title, description, meta_title, meta_description, tags, image_url, created_at, updated_at
         FROM blog_posts WHERE slug = $1`,
        [slug]
      );
      if (!r.rowCount) {
        const to = await redirectFor(slug);
        return to ? { redirect: `/blog/${to}` } : { notFound: true };
      }
      const post = r.rows[0];
      const rel = await pool.query(
        'SELECT slug, title FROM blog_posts WHERE slug <> $1 ORDER BY created_at DESC LIMIT 3',
        [slug]
      );
      const related = rel.rows;
      const url = `${SITE}/blog/${post.slug}`;
      const feature = featureForPost(post);
      const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'BlogPosting',
            headline: post.title,
            description: post.meta_description,
            ...(post.image_url ? { image: post.image_url } : {}),
            datePublished: isoDate(post.created_at),
            dateModified: isoDate(post.updated_at),
            ...(post.tags?.length ? { keywords: post.tags.join(', ') } : {}),
            author: { '@type': 'Organization', name: 'Waynur', url: `${SITE}/` },
            publisher: { '@id': `${SITE}/#organization`, '@type': 'Organization', name: 'Waynur', logo: { '@type': 'ImageObject', url: `${SITE}/waynur-logo.png` } },
            mainEntityOfPage: url,
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
              { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog` },
              { '@type': 'ListItem', position: 3, name: post.title },
            ],
          },
        ],
      };
      const head = headTags({
        title: post.meta_title || post.title,
        description: post.meta_description,
        canonical: url,
        ogType: 'article',
        image: post.image_url,
        jsonLd,
      });
      const updated = fmtDate(post.updated_at) !== fmtDate(post.created_at)
        ? ` · Updated <time datetime="${e(isoDate(post.updated_at))}">${e(fmtDate(post.updated_at))}</time>` : '';
      // post.description is sanitised HTML (services/blogContent.js) — same
      // string the React page injects.
      const body = chrome(`<article class="mx-auto max-w-3xl px-6 pt-10 pb-20">
<p class="text-sm"><a href="/">Home</a> / <a href="/blog">Blog</a></p>
<h1 class="mt-6 font-display text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1]">${e(post.title)}</h1>
<p class="mt-5 text-sm text-ink-soft">By Waynur team · Published <time datetime="${e(isoDate(post.created_at))}">${e(fmtDate(post.created_at))}</time>${updated}</p>
${post.meta_description ? `<p class="mt-6 text-lg leading-relaxed">${e(post.meta_description)}</p>` : ''}
${post.image_url ? `<img src="${e(post.image_url)}" alt="${e(post.title)}" class="mt-8 aspect-[16/9] w-full rounded-2xl object-cover" />` : ''}
<div class="blog-body mt-10">${post.description}</div>
${feature ? `<p class="mt-10">Related feature: <a href="/features/${e(feature.slug)}">${e(feature.navLabel)}</a></p>` : ''}
${related.length ? `<nav aria-label="Related guides" class="mt-10"><h2 class="font-display text-2xl font-semibold">Related guides</h2><ul class="mt-4 space-y-2">${related.map((p) => `<li><a href="/blog/${e(p.slug)}">${e(p.title)}</a></li>`).join('')}</ul></nav>` : ''}
<aside class="mt-12 rounded-2xl bg-ink px-7 py-8 text-cream"><p class="font-display text-2xl font-semibold">Run your school from one dashboard</p><p class="mt-2">Attendance, fees and parent updates on WhatsApp, with far less manual work.</p><p class="mt-4"><a href="/#cta">Book a free demo</a> · <a href="/features">See features</a></p></aside>
</article>`, FEATURE_PAGES);
      return { html: page({ head, body, boot: { post, related } }) };
    });

    if (result.redirect) return res.redirect(301, result.redirect);
    if (result.notFound) {
      const { FEATURE_PAGES: fps } = await loadShared();
      return send(res, {
        status: 404,
        html: page({
          head: headTags({ title: 'Post not found | Waynur Blog', description: 'This article does not exist.', robots: 'noindex, follow' }),
          body: chrome('<div class="mx-auto max-w-2xl px-6 py-24"><h1 class="font-display text-4xl font-semibold">This post is no longer here</h1><p class="mt-4"><a href="/blog">Back to the blog</a></p></div>', fps),
        }),
      });
    }
    send(res, { html: result.html });
  } catch (err) {
    console.error(`SSR /blog/${slug} failed:`, err);
    // A DB error must never look like "post removed" (that is what made
    // Google start dropping the posts). 503 tells crawlers to come back.
    res.set('Retry-After', '120');
    send(res, { status: 503, html: page({ head: headTags({ title: 'Waynur Blog', description: 'Temporarily unavailable.', robots: 'noindex' }), body: '' }) });
  }
});

// ---------- /sitemap.xml ----------

const STATIC_PATHS = ['/', '/features', '/pricing', '/faq', '/team', '/legal', '/demo/teacher-whatsapp', '/blog'];
// Bump when the static pages' copy changes.
const STATIC_LASTMOD = process.env.SITE_STATIC_LASTMOD || '2026-11-21';

router.get('/sitemap.xml', async (req, res) => {
  try {
    const { FEATURE_PAGES } = await loadShared();
    const xml = await cached('sitemap', async () => {
      let posts = [];
      try {
        posts = (await pool.query('SELECT slug, updated_at FROM blog_posts ORDER BY created_at DESC LIMIT 5000')).rows;
      } catch (err) {
        console.error('sitemap: blog query failed, listing static pages only:', err.message);
      }
      const newest = posts.reduce((m, p) => (new Date(p.updated_at) > m ? new Date(p.updated_at) : m), new Date(STATIC_LASTMOD));
      const urls = [
        ...STATIC_PATHS.map((p) => ({ loc: `${SITE}${p === '/' ? '/' : p}`, lastmod: p === '/blog' ? newest.toISOString().slice(0, 10) : STATIC_LASTMOD })),
        ...FEATURE_PAGES.map((f) => ({ loc: `${SITE}/features/${f.slug}`, lastmod: STATIC_LASTMOD })),
        ...posts.map((p) => ({ loc: `${SITE}/blog/${p.slug}`, lastmod: new Date(p.updated_at).toISOString().slice(0, 10) })),
      ];
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((u) => `  <url><loc>${escapeXml(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`)
        .join('\n')}\n</urlset>\n`;
    });
    res.set('Cache-Control', 'public, max-age=600');
    res.type('application/xml').send(xml);
  } catch (err) {
    console.error('sitemap failed:', err);
    res.status(503).type('text/plain').send('Sitemap temporarily unavailable');
  }
});
