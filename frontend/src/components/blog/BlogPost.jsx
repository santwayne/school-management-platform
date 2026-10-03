import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft } from 'lucide-react';
import { LandingNav, LandingFooter } from '../LandingLayout';
import { blogPublicRequest, formatBlogDate } from '../../blogApi';

export default function BlogPost() {
  const { slug } = useParams();
  const [state, setState] = useState({ loading: true, post: null, missing: false });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, post: null, missing: false });
    blogPublicRequest(`/${encodeURIComponent(slug)}`)
      .then((d) => alive && setState({ loading: false, post: d.post, missing: false }))
      .catch(() => alive && setState({ loading: false, post: null, missing: true }));
    return () => { alive = false; };
  }, [slug]);

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
            <time dateTime={post.created_at} className="mt-5 block text-sm text-ink-soft">{formatBlogDate(post.created_at)}</time>

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
