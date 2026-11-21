import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft } from 'lucide-react';
import { LandingNav, LandingFooter } from '../LandingLayout';
import { blogPublicRequest, formatBlogDate } from '../../blogApi';
import { featureForPost } from '../../data/featurePages';

export default function BlogPost() {
  const { slug } = useParams();
  // The server renders /blog/:slug with the post already in the HTML and hands
  // the same data over in window.__WAYNUR_BLOG__, so there is no loading flash
  // and no second request on first load.
  const [state, setState] = useState(() => {
    const boot = typeof window !== 'undefined' ? window.__WAYNUR_BLOG__ : null;
    if (boot?.post?.slug === slug) return { loading: false, post: boot.post, related: boot.related || [], missing: false, error: false };
    return { loading: true, post: null, related: [], missing: false, error: false };
  });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (state.post?.slug === slug) return undefined;
    let alive = true;
    setState({ loading: true, post: null, related: [], missing: false, error: false });
    blogPublicRequest(`/${encodeURIComponent(slug)}`)
      .then((d) => {
        if (!alive) return;
        setState({ loading: false, post: d.post, related: [], missing: false, error: false });
        blogPublicRequest('?limit=4')
          .then((l) => alive && setState((s) => ({ ...s, related: (l.posts || []).filter((p) => p.slug !== d.post.slug).slice(0, 3) })))
          .catch(() => {});
      })
      // Only a real 404 means the post is gone. A 500 or a network blip must
      // not tell readers (and Google) the post was removed.
      .catch((err) => alive && setState({ loading: false, post: null, related: [], missing: err?.status === 404, error: err?.status !== 404 }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, retry]);

  const { post } = state;
  const url = `https://waynur.com/blog/${slug}`;

  return (
    <div className="min-h-screen bg-cream text-ink font-sans flex flex-col">
      {post && (
        <Helmet>
          <title>{post.meta_title}</title>
          <meta name="description" content={post.meta_description} />
          <link rel="canonical" href={url} />
          <meta name="robots" content="index, follow" />
          <meta property="og:type" content="article" />
          <meta property="og:site_name" content="Waynur" />
          <meta property="og:title" content={post.meta_title} />
          <meta property="og:description" content={post.meta_description} />
          <meta property="og:url" content={url} />
          <meta property="og:image" content={post.image_url || 'https://waynur.com/og-image.jpg'} />
          <meta name="twitter:card" content="summary_large_image" />
          {post.tags?.length > 0 && <meta name="keywords" content={post.tags.join(', ')} />}
          <script type="application/ld+json">
            {JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'BlogPosting',
              headline: post.title,
              description: post.meta_description,
              image: post.image_url ? [post.image_url] : undefined,
              datePublished: post.created_at,
              dateModified: post.updated_at,
              keywords: post.tags?.join(', ') || undefined,
              mainEntityOfPage: url,
              author: { '@type': 'Organization', name: 'Waynur', url: 'https://waynur.com/' },
              publisher: { '@type': 'Organization', name: 'Waynur', logo: { '@type': 'ImageObject', url: 'https://waynur.com/waynur-logo.png' } },
            })}
          </script>
        </Helmet>
      )}
      {state.missing && (
        <Helmet>
          <title>Post not found | Waynur Blog</title>
          <meta name="robots" content="noindex, follow" />
        </Helmet>
      )}
      <LandingNav />

      <main className="flex-1">
        {state.loading && (
          <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-terracotta border-t-transparent" />
          </div>
        )}

        {state.error && (
          <div className="mx-auto max-w-2xl px-6 py-24" role="alert">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">This article couldn't load right now</h1>
            <p className="mt-4 text-lg text-ink-soft">Please try again in a moment.</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="mt-8 rounded-full bg-terracotta px-5 py-2.5 text-sm font-semibold text-white hover:bg-terracotta-deep">
              Try again
            </button>
          </div>
        )}

        {state.missing && (
          <div className="mx-auto max-w-2xl px-6 py-24">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">This post is no longer here</h1>
            <p className="mt-4 text-lg text-ink-soft">It may have been renamed or removed.</p>
            <Link to="/blog" className="mt-8 inline-flex items-center gap-2 rounded-full bg-terracotta px-5 py-2.5 text-sm font-semibold text-white hover:bg-terracotta-deep">
              <ArrowLeft className="h-4 w-4" /> Back to the blog
            </Link>
          </div>
        )}

        {post && (
          <article className="mx-auto max-w-3xl px-6 pt-10 pb-20">
            <Link to="/blog" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink">
              <ArrowLeft className="h-4 w-4" /> Blog
            </Link>
            <h1 className="mt-6 font-display text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1] text-ink">{post.title}</h1>
            <p className="mt-5 text-sm text-ink-soft">
              By Waynur team · Published <time dateTime={post.created_at}>{formatBlogDate(post.created_at)}</time>
              {post.updated_at && formatBlogDate(post.updated_at) !== formatBlogDate(post.created_at) && (
                <> · Updated <time dateTime={post.updated_at}>{formatBlogDate(post.updated_at)}</time></>
              )}
            </p>

            {post.meta_description && (
              <p className="mt-6 text-lg text-ink leading-relaxed">{post.meta_description}</p>
            )}

            {post.image_url && (
              <img src={post.image_url} alt={post.title} className="mt-8 aspect-[16/9] w-full rounded-2xl object-cover bg-cream-deep" />
            )}

            {/* Safe to inject: the server sanitises the description when it is saved (backend/services/blogContent.js). */}
            <div className="blog-body mt-10" dangerouslySetInnerHTML={{ __html: post.description }} />

            {post.tags?.length > 0 && (
              <ul className="mt-12 flex flex-wrap gap-2 border-t border-cream-deep pt-6">
                {post.tags.map((t) => (
                  <li key={t}>
                    <Link to={`/blog?tag=${encodeURIComponent(t)}`} className="rounded-full border border-border bg-white px-3 py-1 text-sm text-ink-soft hover:border-terracotta hover:text-terracotta-deep">
                      {t}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {(() => {
              const f = featureForPost(post);
              return (
                <p className="mt-10 text-ink-soft">
                  Related feature: <Link to={`/features/${f.slug}`} className="font-medium text-terracotta hover:underline">{f.navLabel}</Link>
                </p>
              );
            })()}

            {state.related.length > 0 && (
              <nav aria-label="Related guides" className="mt-10">
                <h2 className="font-display text-2xl font-semibold text-ink">Related guides</h2>
                <ul className="mt-4 space-y-2">
                  {state.related.map((r) => (
                    <li key={r.slug}><Link to={`/blog/${r.slug}`} className="text-terracotta hover:underline">{r.title}</Link></li>
                  ))}
                </ul>
              </nav>
            )}

            <aside className="mt-12 rounded-2xl bg-ink px-7 py-8 text-cream">
              <p className="font-display text-2xl font-semibold">Run your school from one dashboard</p>
              <p className="mt-2 text-cream/80">Attendance, fees and parent updates on WhatsApp, with far less manual work.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link to="/onboarding" className="rounded-full bg-terracotta px-5 py-2.5 text-sm font-semibold text-white hover:bg-terracotta-deep">Set up Waynur</Link>
                <Link to="/features" className="rounded-full border border-cream/30 px-5 py-2.5 text-sm font-semibold text-cream hover:border-cream">See features</Link>
              </div>
            </aside>
          </article>
        )}
      </main>
      <LandingFooter />
    </div>
  );
}
