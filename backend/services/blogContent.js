import sanitizeHtml from 'sanitize-html';

// Pure helpers for the website blog (routes/blog.js). Kept free of DB / env
// access so they can be unit-tested directly.

export const LIMITS = {
  title: 200,
  metaTitle: 255,
  metaDescription: 500,
  slug: 120,
  tags: 12,
  tagLength: 40,
  description: 200_000, // characters of HTML
};

// "10 Ways to Cut Fee Defaults!" -> "10-ways-to-cut-fee-defaults"
export function slugify(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slug)
    .replace(/-+$/g, '');
}

// Accepts an array or a comma-separated string. Trims, drops blanks and
// case-insensitive duplicates, caps count and length.
export function parseTags(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const tag = String(item || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.tagLength);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

// The description is written in a rich-text editor and rendered as HTML on
// the public site, so it is cleaned on the way IN — whatever is stored is
// safe to render. Only plain article markup survives; scripts, styles,
// event handlers, iframes and javascript: links are dropped.
export function sanitizeDescription(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: ['p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'blockquote', 'hr'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    // Editors leave empty blocks behind (<p></p>, <li><br></li>) — drop them.
    exclusiveFilter: (frame) => ['p', 'h2', 'h3', 'h4', 'li', 'blockquote', 'a', 'ul', 'ol'].includes(frame.tag) && !frame.text.trim(),
    transformTags: {
      div: 'p',
      h1: 'h2',
      a: (tagName, attribs) => {
        const href = attribs.href || '';
        const external = /^https?:\/\//i.test(href) && !/^https?:\/\/(www\.)?waynur\.com(\/|$)/i.test(href);
        return {
          tagName: 'a',
          attribs: external ? { href, target: '_blank', rel: 'noopener noreferrer' } : { href },
        };
      },
    },
  }).trim();
}

export function plainText(html) {
  return sanitizeHtml(String(html || ''), { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}

export function isHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

// Validates + normalises a post payload. Returns { value } or { error }.
export function normalisePost(body = {}) {
  const title = String(body.title || '').trim();
  if (!title) return { error: 'Title is required' };
  if (title.length > LIMITS.title) return { error: `Title must be ${LIMITS.title} characters or fewer` };

  const slug = slugify(body.slug || title);
  if (!slug) return { error: 'Slug must contain letters or numbers' };

  if (String(body.description || '').length > LIMITS.description) return { error: 'Description is too long' };
  const description = sanitizeDescription(body.description);
  if (!plainText(description)) return { error: 'Description is required' };

  const metaTitle = String(body.meta_title || '').trim() || title;
  if (metaTitle.length > LIMITS.metaTitle) return { error: `Meta title must be ${LIMITS.metaTitle} characters or fewer` };

  // Left empty, fall back to the opening of the article so search results
  // and the blog list never show a blank description.
  let metaDescription = String(body.meta_description || '').replace(/\s+/g, ' ').trim();
  if (!metaDescription) {
    const text = plainText(description);
    metaDescription = text.length > 155 ? `${text.slice(0, 155).replace(/\s+\S*$/, '')}…` : text;
  }
  if (metaDescription.length > LIMITS.metaDescription) return { error: `Meta description must be ${LIMITS.metaDescription} characters or fewer` };

  const imageUrl = String(body.image_url || '').trim();
  if (imageUrl && !isHttpUrl(imageUrl)) return { error: 'Image must be an uploaded image URL' };

  return {
    value: {
      title,
      slug,
      description,
      meta_title: metaTitle,
      meta_description: metaDescription,
      tags: parseTags(body.tags),
      image_url: imageUrl || null,
    },
  };
}

export function escapeXml(s) {
  return String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}
