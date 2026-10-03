import express from 'express';
import crypto from 'crypto';
import path from 'path';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import pool from '../config/db.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { s3, s3PublicUrl } from '../utils/s3.js';
import { normalisePost, escapeXml } from '../services/blogContent.js';

// ------------------------------------------------------------------
// Website blog (waynur.com/blog).
//   /api/blog-admin/*    the blog panel at /blog-admin — its OWN login
//   /api/public/blog/*   no auth: what the public blog pages read
//
// Deliberately separate from the school dashboard and the Super Admin
// panel: no row in teachers/super_admins, no school_id, and tokens are
// signed with a different key (derived from JWT_SECRET), so
//   - a dashboard / super-admin token is rejected here, and
//   - a blog-admin token is rejected by middleware/auth.js everywhere else.
// The one login comes from BLOG_ADMIN_EMAIL + BLOG_ADMIN_PASSWORD.
// ------------------------------------------------------------------

export const adminRouter = express.Router();
export const publicRouter = express.Router();

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://waynur.com').replace(/\/+$/, '');
const TOKEN_TTL = '12h';

function blogSecret() {
  if (!process.env.JWT_SECRET) return null;
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update('waynur-blog-admin-v1').digest('hex');
}

// Constant-time compare that doesn't leak length either.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireBlogAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const secret = blogSecret();
  if (!token || !secret) return res.status(401).json({ error: 'Blog admin login required' });
  try {
    const payload = jwt.verify(token, secret);
    if (payload.scope !== 'blog_admin') throw new Error('wrong scope');
    req.blogAdmin = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Blog admin login required' });
  }
}

const sendError = (res, err, fallback) => {
  if (err?.code === '23505') return res.status(409).json({ error: 'Another post already uses this slug — change the slug and save again.' });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

// ---------- Admin: login ----------

adminRouter.post('/login', loginLimiter, (req, res) => {
  const adminEmail = (process.env.BLOG_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = process.env.BLOG_ADMIN_PASSWORD || '';
  const secret = blogSecret();
  if (!adminEmail || !adminPassword || !secret) {
    return res.status(503).json({ error: 'Blog admin is not set up yet — add BLOG_ADMIN_EMAIL and BLOG_ADMIN_PASSWORD on the server.' });
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const ok = safeEqual(email, adminEmail) & safeEqual(password, adminPassword);
  if (!ok) return res.status(401).json({ error: 'Wrong email or password' });
  const token = jwt.sign({ scope: 'blog_admin', email: adminEmail }, secret, { expiresIn: TOKEN_TTL });
  res.json({ token, email: adminEmail });
});

adminRouter.get('/me', requireBlogAdmin, (req, res) => res.json({ email: req.blogAdmin.email }));

// ---------- Admin: posts ----------

adminRouter.get('/posts', requireBlogAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, slug, title, meta_title, meta_description, tags, image_url, created_at, updated_at
       FROM blog_posts ORDER BY created_at DESC`
    );
    res.json({ posts: r.rows });
  } catch (err) { sendError(res, err, 'Failed to load posts'); }
});

adminRouter.get('/posts/:id', requireBlogAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'Post not found' });
  try {
    const r = await pool.query('SELECT * FROM blog_posts WHERE id = $1', [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Post not found' });
    res.json({ post: r.rows[0] });
  } catch (err) { sendError(res, err, 'Failed to load post'); }
});

adminRouter.post('/posts', requireBlogAdmin, async (req, res) => {
  const { value: p, error } = normalisePost(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const r = await pool.query(
      `INSERT INTO blog_posts (slug, title, description, meta_title, meta_description, tags, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [p.slug, p.title, p.description, p.meta_title, p.meta_description, p.tags, p.image_url]
    );
    res.status(201).json({ post: r.rows[0] });
  } catch (err) { sendError(res, err, 'Failed to save post'); }
});

adminRouter.put('/posts/:id', requireBlogAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'Post not found' });
  const { value: p, error } = normalisePost(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const r = await pool.query(
      `UPDATE blog_posts
       SET slug = $2, title = $3, description = $4, meta_title = $5, meta_description = $6, tags = $7, image_url = $8, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, p.slug, p.title, p.description, p.meta_title, p.meta_description, p.tags, p.image_url]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Post not found' });
    res.json({ post: r.rows[0] });
  } catch (err) { sendError(res, err, 'Failed to save post'); }
});

adminRouter.delete('/posts/:id', requireBlogAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'Post not found' });
  try {
    const r = await pool.query('DELETE FROM blog_posts WHERE id = $1', [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Post not found' });
    res.json({ deleted: true });
  } catch (err) { sendError(res, err, 'Failed to delete post'); }
});

// ---------- Admin: image upload (S3, blog/ prefix) ----------

// No SVG: an SVG can carry script and would be served from our bucket.
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_TYPES[file.mimetype]) return cb(new Error('Image must be a JPG, PNG, WebP or GIF'));
    cb(null, true);
  },
});

adminRouter.post('/upload', requireBlogAdmin, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 5 MB' : err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  if (!process.env.AWS_S3_BUCKET) return res.status(503).json({ error: 'Image storage is not configured (AWS_S3_BUCKET missing on the server).' });

  const base = path.basename(req.file.originalname, path.extname(req.file.originalname))
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  const key = `blog/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${base}${IMAGE_TYPES[req.file.mimetype]}`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    res.json({ url: s3PublicUrl(key) });
  } catch (err) {
    console.error('Blog image upload error:', err);
    res.status(500).json({ error: 'Upload failed — check S3 credentials and that the bucket policy allows public read on blog/*' });
  }
});

// ---------- Public ----------

publicRouter.get('/', async (req, res) => {
  const tag = String(req.query.tag || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 50);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const where = tag ? 'WHERE EXISTS (SELECT 1 FROM unnest(tags) t WHERE lower(t) = lower($1))' : '';
  const params = tag ? [tag] : [];
  try {
    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT slug, title, meta_description, tags, image_url, created_at, updated_at
         FROM blog_posts ${where} ORDER BY created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit]
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM blog_posts ${where}`, params),
    ]);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ posts: rows.rows, total: count.rows[0].total, page, limit });
  } catch (err) { sendError(res, err, 'Failed to load blog'); }
});

// Listed in robots.txt next to the static sitemap, so new posts are
// discoverable without rebuilding the frontend.
publicRouter.get('/sitemap.xml', async (req, res) => {
  try {
    const r = await pool.query('SELECT slug, updated_at FROM blog_posts ORDER BY created_at DESC LIMIT 5000');
    const urls = [
      `  <url><loc>${SITE_URL}/blog</loc></url>`,
      ...r.rows.map((p) => `  <url><loc>${SITE_URL}/blog/${escapeXml(p.slug)}</loc><lastmod>${new Date(p.updated_at).toISOString().slice(0, 10)}</lastmod></url>`),
    ];
    res.set('Cache-Control', 'public, max-age=600');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  } catch (err) { sendError(res, err, 'Failed to build sitemap'); }
});

// Link-preview HTML for crawlers that don't run JavaScript (WhatsApp,
// Facebook, LinkedIn, X). nginx sends those user agents here for /blog/:slug
// (see deploy/nginx-waynur.conf); real visitors get the React page.
publicRouter.get('/:slug/preview', async (req, res) => {
  try {
    const r = await pool.query('SELECT slug, title, meta_title, meta_description, image_url FROM blog_posts WHERE slug = $1', [req.params.slug]);
    if (!r.rowCount) return res.status(404).type('text/plain').send('Not found');
    const p = r.rows[0];
    const url = `${SITE_URL}/blog/${p.slug}`;
    const e = escapeXml;
    res.set('Cache-Control', 'public, max-age=300');
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${e(p.meta_title)}</title>
<meta name="description" content="${e(p.meta_description)}">
<link rel="canonical" href="${e(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Waynur">
<meta property="og:title" content="${e(p.meta_title)}">
<meta property="og:description" content="${e(p.meta_description)}">
<meta property="og:url" content="${e(url)}">
${p.image_url ? `<meta property="og:image" content="${e(p.image_url)}">\n` : ''}<meta name="twitter:card" content="${p.image_url ? 'summary_large_image' : 'summary'}">
</head><body><h1>${e(p.title)}</h1><p>${e(p.meta_description)}</p><a href="${e(url)}">Read on Waynur</a></body></html>`);
  } catch (err) { sendError(res, err, 'Failed to load post'); }
});

publicRouter.get('/:slug', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT slug, title, description, meta_title, meta_description, tags, image_url, created_at, updated_at
       FROM blog_posts WHERE slug = $1`,
      [String(req.params.slug).toLowerCase()]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Post not found' });
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ post: r.rows[0] });
  } catch (err) { sendError(res, err, 'Failed to load post'); }
});
