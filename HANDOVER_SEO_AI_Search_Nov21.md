# Handover — On-page & AI-search fixes (Nov 21, 2026)

Implements "Waynur.com — On-Page & AI-Search Fix Guide for Developer" (Nov 18).
Branch: `fix/seo-ai-search-prerender`

## What changed

| Guide item | Done how |
|---|---|
| P0-A blog | Live API was working again on 21 Nov (3 posts). `/blog/school-management-software-india-checklist` has **no post in the DB** → now 301s to the Ludhiana post (`backend/config/blogRedirects.json`). If Mandeep republishes it with that exact slug, the real post wins automatically. Slug renames in /blog-admin now create a 301 automatically (`blog_slug_redirects` table). A DB error now returns **503** (retry later), never "post removed". |
| P0-B raw HTML | `npm run build` now pre-renders every public page into `dist/<route>/index.html` (`src/entry-server.jsx` + `scripts/prerender.mjs`). `/blog` and `/blog/:slug` are rendered by Express (`backend/routes/site.js`) with title, meta, canonical, OG, H1, full article, BlogPosting + BreadcrumbList JSON-LD. Unknown slug → HTTP 404. 10-min cache, cleared on save. |
| Titles / meta / H1 | Per the guide's table (`src/data/seoHead.js`, bottom section). Home intro paragraph from the guide is the first paragraph under the H1. |
| Feature pages | 6 new pages `/features/<slug>` (copy in `src/data/featurePages.js`), FAQPage + Breadcrumb JSON-LD, linked from header dropdown, footer and /features. `/fees`, `/parent-app`, `/exams` → 301 (nginx) to the new pages. Unconfirmed `[confirm]` claims were left out. |
| Pricing | Uses the plans the billing code actually sells: **Core ₹400 / AI ₹650 per student per year, plus GST** (Option B). Starter/Growth/District removed from site, schema and llms.txt. One place to change: `src/data/siteContent.js` → `PRICING`. |
| FAQ | 16 Q&As incl. the guide's 10, all visible; FAQPage JSON-LD built from the same array. |
| robots.txt / llms.txt / sitemap | Replaced as per guide. Single `/sitemap.xml` from the backend (static + features + posts, real lastmod). Static `public/sitemap.xml` deleted. |
| IndexNow | `backend/services/indexNow.js`, pinged on every publish/edit/delete when `INDEXNOW_KEY` is set. |
| Footer | "Waynur · info@waynur.com · Ludhiana" + "Made by Wayne E Solutions" link + feature links. "Last updated" on /features, /pricing, /faq. |

## Deploy (EC2)

```bash
cd /home/ubuntu/school-management-platform
git fetch && git checkout fix/seo-ai-search-prerender   # or merge to master first
cd backend && npm ci && pm2 restart waynur-backend      # schema.sql adds blog_slug_redirects on boot
cd ../frontend && npm ci && npm run build               # build now also pre-renders
sudo rsync -a --delete dist/ /var/www/waynur/
```

nginx: merge the new blocks from `deploy/nginx-waynur.conf` into the live server block
(keep the live SSL/certbot lines). The important parts:
- `location ~ ^/blog(/.*)?$` and `location = /sitemap.xml` → proxy to :5000
- `location /` → `try_files $uri $uri/index.html /spa.html;` (**spa.html**, not index.html —
  index.html is now the pre-rendered home page)
- the 3 `return 301` lines and the trailing-slash rewrite

Then `sudo nginx -t && sudo systemctl reload nginx`.

Backend env (optional): `INDEXNOW_KEY=<32 hex>` and put `frontend/public/<key>.txt` containing the
key, rebuild. `FRONTEND_DIST` only if the build is not at `/var/www/waynur`.

## Test after deploy (all must pass)

```bash
curl -s -A "OAI-SearchBot" https://waynur.com/pricing | grep -o "<title[^<]*"
curl -s -A "ClaudeBot" https://waynur.com/pricing | grep -c "<h1"
curl -s -A "bingbot" https://waynur.com/ | grep -c "application/ld+json"
curl -s -A "ClaudeBot" https://waynur.com/blog/school-management-software-ludhiana-punjab | grep -c "<h1"
curl -s -o /dev/null -w "%{http_code}\n" https://waynur.com/blog/this-does-not-exist          # 404
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://waynur.com/blog/school-management-software-india-checklist  # 301
curl -s https://waynur.com/sitemap.xml | grep -c "<loc>"
curl -s -o /dev/null -w "%{http_code}\n" https://waynur.com/dashboard                          # 200 (SPA)
```
Also check that no Cloudflare/firewall rule returns 403 to those user agents.

Still manual: UptimeRobot on /blog + one post (alert info@waynur.com); submit sitemap in
Google Search Console + Bing Webmaster; validator.schema.org on home, /faq, one feature page, one post.

## Needs Pankaj
- `og-image.jpg` (1200×630) is referenced everywhere but **does not exist** in `public/` — add it.
- "WhatsApp message charges are included" was removed from pricing copy (with per-school
  WhatsApp numbers Meta may bill the school's own account). Re-add only if true.
- Board support (CBSE/ICSE/state), alert opt-outs, payment surcharge, reminder languages:
  left off the feature pages until confirmed.
- Add YouTube / Facebook / G2 URLs to `sameAs` in `src/data/seoHead.js` when they exist.
