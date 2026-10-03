// API client for the website blog.
//
// Deliberately NOT built on src/api.js: the blog panel has its own login and
// its own token (different localStorage key, different signing key on the
// server). It never reads or writes the dashboard session, and a 401 here
// never redirects to the school /login page.
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '');
const TOKEN_KEY = 'waynur_blog_admin_token';

export const blogSession = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (token) => { try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

export class BlogApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function parse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new BlogApiError(data.error || `Request failed (${res.status})`, res.status);
  return data;
}

function authHeaders() {
  const token = blogSession.get();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function blogAdminRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}/api/blog-admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  return parse(res);
}

export async function blogAdminUpload(file) {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch(`${API_URL}/api/blog-admin/upload`, { method: 'POST', headers: authHeaders(), body: form });
  return parse(res);
}

export async function blogPublicRequest(path = '') {
  const res = await fetch(`${API_URL}/api/public/blog${path}`);
  return parse(res);
}

// Mirrors slugify() in backend/services/blogContent.js so the slug the
// editor shows is the slug the server will store.
export function slugify(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}

export function formatBlogDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}
