import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { LandingNav, LandingFooter } from '../LandingLayout';
import { blogPublicRequest, formatBlogDate } from '../../blogApi';

const PAGE_SIZE = 12;
const TITLE = 'Waynur Blog: School Management Ideas and Guides';
const DESCRIPTION = 'Practical guides for school owners, principals and administrators on fees, attendance, parent communication and running a school with less manual work.';

function PostRow({ post, lead }) {
  return (
    <article className={!post.image_url ? '' : lead ? 'grid gap-6 md:grid-cols-[1.25fr_1fr] md:items-center' : 'grid gap-5 sm:grid-cols-[14rem_1fr] sm:items-start'}>
      {post.image_url && (
        <Link to={`/blog/${post.slug}`} className="block overflow-hidden rounded-2xl bg-cream-deep" tabIndex={-1} aria-hidden>
          <img src={post.image_url} alt="" loading={lead ? 'eager' : 'lazy'} className="aspect-[16/9] w-full object-cover" />
        </Link>
      )}
      <div>
        <time dateTime={post.created_at} className="text-sm text-ink-soft">{formatBlogDate(post.created_at)}</time>
        <h2 className={`mt-2 font-display font-semibold tracking-tight text-ink ${lead ? 'text-3xl md:text-4xl' : 'text-2xl'}`}>
          <Link to={`/blog/${post.slug}`} className="hover:text-terracotta-deep">{post.title}</Link>
        </h2>
        {post.meta_description && (
          <p className={`mt-3 max-w-2xl text-ink-soft leading-relaxed ${lead ? 'text-lg' : ''}`}>{post.meta_description}</p>
        )}
        {post.tags?.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {post.tags.map((t) => (
              <li key={t}>
                <Link to={`/blog?tag=${encodeURIComponent(t)}`} className="rounded-full border border-border bg-white px-3 py-1 text-sm text-ink-soft hover:border-terracotta hover:text-terracotta-deep">
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

export default function BlogIndex() {
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag') || '';
  const page = Math.max(parseInt(params.get('page'), 10) || 1, 1);
  const [state, setState] = useState({ loading: true, posts: [], total: 0, error: '' });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    const qs = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (tag) qs.set('tag', tag);
    blogPublicRequest(`?${qs}`)
      .then((d) => alive && setState({ loading: false, posts: d.posts, total: d.total, error: '' }))
      .catch(() => alive && setState({ loading: false, posts: [], total: 0, error: 'The blog could not be loaded. Please refresh the page.' }));
    return () => { alive = false; };
  }, [tag, page]);

  const pages = Math.ceil(state.total / PAGE_SIZE);
  const goTo = (n) => {
    const next = new URLSearchParams(params);
    if (n <= 1) next.delete('page'); else next.set('page', String(n));
    setParams(next);
  };
  const [lead, ...rest] = state.posts;
  const showLead = !tag && page === 1 && lead;

  return (
    <div className="min-h-screen bg-cream text-ink font-sans flex flex-col">
      <Helmet>
        <title>{tag ? `${tag} | Waynur Blog` : TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href="https://waynur.com/blog" />
        <meta name="robots" content={tag || page > 1 ? 'noindex, follow' : 'index, follow'} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Waynur" />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content="https://waynur.com/blog" />
        <meta property="og:image" content="https://waynur.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>
      <LandingNav />

      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-6 pt-14 pb-20">
          <h1 className="font-display text-4xl md:text-5xl font-semibold tracking-tight text-ink">
            {tag ? <>Posts on {tag}</> : 'The Waynur blog'}
          </h1>
          {tag ? (
            <Link to="/blog" className="mt-4 inline-block text-sm font-medium text-terracotta-deep underline underline-offset-4 hover:text-terracotta">All posts</Link>
          ) : (
            <p className="mt-4 max-w-2xl text-lg text-ink-soft leading-relaxed">
              Guides on fees, attendance, parent communication and running a school with less manual work.
            </p>
          )}

          {state.loading && (
            <div className="mt-16 flex justify-center" role="status" aria-label="Loading">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-terracotta border-t-transparent" />
            </div>
          )}
          {state.error && <p className="mt-12 text-ink-soft" role="alert">{state.error}</p>}
          {!state.loading && !state.error && state.posts.length === 0 && (
            <p className="mt-12 text-ink-soft">{tag ? 'No posts with this tag yet.' : 'The first posts are on their way. Check back soon.'}</p>
          )}

          {!state.loading && state.posts.length > 0 && (
            <>
              {showLead && (
                <div className="mt-12 border-b border-cream-deep pb-12">
                  <PostRow post={lead} lead />
                </div>
              )}
              <div className="mt-12 space-y-12">
                {(showLead ? rest : state.posts).map((p) => <PostRow key={p.slug} post={p} />)}
              </div>
            </>
          )}

          {pages > 1 && (
            <nav className="mt-16 flex items-center justify-between border-t border-cream-deep pt-6 text-sm" aria-label="Blog pages">
              <button type="button" disabled={page <= 1} onClick={() => goTo(page - 1)} className="font-medium text-terracotta-deep hover:text-terracotta disabled:text-ink-soft/50">Newer posts</button>
              <span className="text-ink-soft">Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => goTo(page + 1)} className="font-medium text-terracotta-deep hover:text-terracotta disabled:text-ink-soft/50">Older posts</button>
            </nav>
          )}
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
