import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, ExternalLink, ImagePlus, Loader2, LogOut, Pencil, Plus, Trash2, X } from 'lucide-react';
import logoFull from '../../assets/waynur-logo.png';
import RichText from './RichText';
import { blogAdminRequest, blogAdminUpload, blogSession, formatBlogDate, slugify } from '../../blogApi';

// Standalone blog panel at /blog-admin.
//
// Not part of any dashboard: it is not wrapped in ProtectedRoute, does not
// use AuthContext, has no sidebar shell, and signs in with its own
// credentials (BLOG_ADMIN_EMAIL / BLOG_ADMIN_PASSWORD on the server).

const EMPTY = { meta_title: '', meta_description: '', slug: '', tags: [], title: '', description: '', image_url: '' };
const META_TITLE_IDEAL = 60;
const META_DESC_IDEAL = 160;

const inputCls =
  'w-full rounded-xl border border-border bg-white px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-soft/60 outline-none focus:border-terracotta focus:ring-2 focus:ring-terracotta/20';

function Field({ label, htmlFor, hint, counter, children, labelId }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label id={labelId} htmlFor={htmlFor} className="text-sm font-semibold text-ink">{label}</label>
        {counter}
      </div>
      {children}
      {hint && <p className="mt-1.5 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

function Counter({ length, ideal }) {
  return (
    <span className={`text-xs tabular-nums ${length > ideal ? 'text-terracotta-deep font-semibold' : 'text-ink-soft'}`}>
      {length} / {ideal}
    </span>
  );
}

function Notice({ tone = 'error', children }) {
  const cls = tone === 'error'
    ? 'border-red-200 bg-red-50 text-red-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

// ---------- Login ----------

function LoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await blogAdminRequest('/login', { method: 'POST', body: { email, password } });
      blogSession.set(data.token);
      onSignedIn(data.email);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-6 py-12">
      <form onSubmit={submit} className="w-full max-w-sm">
        <img src={logoFull} alt="Waynur" className="h-11 w-auto" />
        <h1 className="mt-8 font-display text-3xl font-semibold tracking-tight text-ink">Blog admin</h1>
        <p className="mt-2 text-sm text-ink-soft">Sign in to write and edit posts for waynur.com/blog.</p>
        <div className="mt-7 space-y-4">
          <Field label="Email" htmlFor="blog-email">
            <input id="blog-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Password" htmlFor="blog-password">
            <input id="blog-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
          </Field>
          {error && <Notice>{error}</Notice>}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-terracotta px-5 py-3 text-sm font-semibold text-white hover:bg-terracotta-deep disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- Post list ----------

function PostList({ posts, loading, error, onNew, onEdit, onDelete }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Blog posts</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {loading ? 'Loading…' : posts.length === 0 ? 'Nothing published yet.' : `${posts.length} published on waynur.com/blog`}
          </p>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-2 rounded-full bg-terracotta px-5 py-2.5 text-sm font-semibold text-white hover:bg-terracotta-deep"
        >
          <Plus className="h-4 w-4" /> New post
        </button>
      </div>

      {error && <div className="mt-6"><Notice>{error}</Notice></div>}

      {!loading && posts.length === 0 && !error && (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-white/60 px-6 py-14 text-center">
          <p className="font-display text-xl text-ink">Write the first post</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
            A post goes live on the blog as soon as you save it.
          </p>
          <button type="button" onClick={onNew} className="mt-5 inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-semibold text-ink hover:border-terracotta hover:text-terracotta-deep">
            <Plus className="h-4 w-4" /> New post
          </button>
        </div>
      )}

      {posts.length > 0 && (
        <ul className="mt-8 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white">
          {posts.map((p) => (
            <li key={p.id} className="flex items-center gap-4 px-4 py-4 sm:px-5">
              <div className="hidden h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-cream-deep sm:block">
                {p.image_url && <img src={p.image_url} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => onEdit(p.id)} className="block max-w-full truncate text-left font-semibold text-ink hover:text-terracotta-deep">
                  {p.title}
                </button>
                <div className="mt-0.5 truncate text-sm text-ink-soft">/blog/{p.slug}</div>
                <div className="mt-1 text-xs text-ink-soft">
                  {formatBlogDate(p.created_at)}
                  {p.tags?.length > 0 && <span className="ml-2">{p.tags.join(', ')}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a href={`/blog/${p.slug}`} target="_blank" rel="noopener noreferrer" title="View on site" aria-label={`View ${p.title} on site`} className="grid h-9 w-9 place-items-center rounded-full text-ink-soft hover:bg-cream-deep hover:text-ink">
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button type="button" onClick={() => onEdit(p.id)} title="Edit" aria-label={`Edit ${p.title}`} className="grid h-9 w-9 place-items-center rounded-full text-ink-soft hover:bg-cream-deep hover:text-ink">
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => onDelete(p)} title="Delete" aria-label={`Delete ${p.title}`} className="grid h-9 w-9 place-items-center rounded-full text-ink-soft hover:bg-red-50 hover:text-red-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Editor ----------

function TagsInput({ id, tags, onChange }) {
  const [draft, setDraft] = useState('');

  const commit = (text) => {
    const next = [...tags];
    text.split(',').map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach((t) => {
      if (next.length < 12 && !next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t.slice(0, 40));
    });
    onChange(next);
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-white px-2.5 py-2 focus-within:border-terracotta focus-within:ring-2 focus-within:ring-terracotta/20">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-cream-deep px-2.5 py-1 text-sm text-ink">
          {t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`} className="rounded-full text-ink-soft hover:text-ink">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => (e.target.value.includes(',') ? commit(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) commit(draft); }
          if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={tags.length ? '' : 'school fees, attendance'}
        className="min-w-[6rem] flex-1 bg-transparent px-1 py-1 text-[15px] text-ink placeholder:text-ink-soft/60 outline-none focus:outline-none focus-visible:outline-none"
      />
    </div>
  );
}

function ImageField({ url, onChange, onError }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onError('');
    setBusy(true);
    try {
      const data = await blogAdminUpload(file);
      onChange(data.url);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input ref={fileRef} id="blog-image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={pick} className="sr-only" />
      {url ? (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <img src={url} alt="Post image preview" className="aspect-[16/9] w-full object-cover" />
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-2 text-sm font-semibold text-terracotta-deep hover:text-terracotta disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Replace image
            </button>
            <button type="button" onClick={() => onChange('')} className="text-sm text-ink-soft hover:text-red-700">Remove</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-white text-ink-soft hover:border-terracotta hover:text-terracotta-deep disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
          <span className="text-sm font-semibold">{busy ? 'Uploading…' : 'Upload image'}</span>
          <span className="text-xs">JPG, PNG or WebP, up to 5 MB. 1200 × 630 works best.</span>
        </button>
      )}
    </div>
  );
}

function Editor({ postId, onBack, onSaved, onSessionExpired }) {
  const [form, setForm] = useState(EMPTY);
  const [savedId, setSavedId] = useState(postId);
  const [slugTouched, setSlugTouched] = useState(Boolean(postId));
  const [loading, setLoading] = useState(Boolean(postId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedSlug, setSavedSlug] = useState('');
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(''); // '' | 'published' | 'saved'

  useEffect(() => {
    if (!postId) return;
    let alive = true;
    blogAdminRequest(`/posts/${postId}`)
      .then(({ post }) => {
        if (!alive) return;
        setForm({ ...EMPTY, ...post, tags: post.tags || [], image_url: post.image_url || '' });
        setSavedSlug(post.slug);
      })
      .catch((err) => (err.status === 401 ? onSessionExpired() : alive && setError(err.message)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [postId, onSessionExpired]);

  // Warn before closing the tab with unsaved writing.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); setJustSaved(''); };

  const onTitle = (title) => set(slugTouched ? { title } : { title, slug: slugify(title) });

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = { ...form, slug: slugify(form.slug || form.title) };
      const { post } = savedId
        ? await blogAdminRequest(`/posts/${savedId}`, { method: 'PUT', body })
        : await blogAdminRequest('/posts', { method: 'POST', body });
      setSavedId(post.id);
      setSlugTouched(true);
      setSavedSlug(post.slug);
      setForm({ ...EMPTY, ...post, tags: post.tags || [], image_url: post.image_url || '' });
      setDirty(false);
      setJustSaved(savedId ? 'saved' : 'published');
      onSaved();
    } catch (err) {
      if (err.status === 401) onSessionExpired();
      else setError(err.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    if (dirty && !window.confirm('Leave without saving? Your changes will be lost.')) return;
    onBack();
  };

  if (loading) {
    return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>;
  }

  const metaTitle = form.meta_title || form.title;
  const previewSlug = slugify(form.slug || form.title);

  return (
    <form onSubmit={save} className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={back} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> All posts
        </button>
        <div className="flex items-center gap-3">
          {savedSlug && !dirty && (
            <a href={`/blog/${savedSlug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-terracotta-deep hover:text-terracotta">
              View on site <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-terracotta px-6 py-2.5 text-sm font-semibold text-white hover:bg-terracotta-deep disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {savedId ? 'Save changes' : 'Publish post'}
          </button>
        </div>
      </div>

      <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">{savedId ? 'Edit post' : 'New post'}</h1>

      <div className="mt-4 space-y-3">
        {error && <Notice>{error}</Notice>}
        {justSaved && !error && (
          <Notice tone="ok">{justSaved === 'published' ? 'Published.' : 'Changes saved.'} The post is live at /blog/{savedSlug}.</Notice>
        )}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Search details first on small screens only because they are short; on desktop they sit in the side column. */}
        <aside className="space-y-5 lg:order-2">
          <div className="rounded-2xl border border-border bg-white p-5 space-y-5">
            <Field label="Meta title" htmlFor="blog-meta-title" counter={<Counter length={metaTitle.length} ideal={META_TITLE_IDEAL} />} hint="The headline shown in Google. Left empty, the post title is used.">
              <input id="blog-meta-title" value={form.meta_title} onChange={(e) => set({ meta_title: e.target.value })} maxLength={255} placeholder={form.title} className={inputCls} />
            </Field>
            <Field label="Meta description" htmlFor="blog-meta-desc" counter={<Counter length={form.meta_description.length} ideal={META_DESC_IDEAL} />} hint="One or two sentences shown under the headline in Google and on the blog list.">
              <textarea id="blog-meta-desc" rows={4} value={form.meta_description} onChange={(e) => set({ meta_description: e.target.value })} maxLength={500} className={`${inputCls} resize-y`} />
            </Field>
            <Field label="Slug" htmlFor="blog-slug" hint="The last part of the web address. Lowercase letters, numbers and hyphens.">
              <div className="flex items-stretch overflow-hidden rounded-xl border border-border bg-white focus-within:border-terracotta focus-within:ring-2 focus-within:ring-terracotta/20">
                <span className="flex items-center bg-cream-deep/60 px-3 text-sm text-ink-soft">/blog/</span>
                <input
                  id="blog-slug"
                  value={form.slug}
                  onChange={(e) => { setSlugTouched(true); set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-') }); }}
                  onBlur={() => form.slug && set({ slug: slugify(form.slug) })}
                  maxLength={120}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[15px] text-ink outline-none"
                />
              </div>
            </Field>
            <Field label="Tags" htmlFor="blog-tags" hint="Press Enter or comma after each tag.">
              <TagsInput id="blog-tags" tags={form.tags} onChange={(tags) => set({ tags })} />
            </Field>
          </div>

          <div className="rounded-2xl border border-border bg-white p-5">
            <div className="text-sm font-semibold text-ink">How it looks in Google</div>
            <div className="mt-3 font-[arial,sans-serif]">
              <div className="truncate text-xs text-[#4d5156]">waynur.com › blog › {previewSlug || 'your-post'}</div>
              <div className="mt-1 line-clamp-2 text-lg leading-snug text-[#1a0dab]">{metaTitle || 'Post title'}</div>
              <div className="mt-1 line-clamp-3 text-sm leading-snug text-[#4d5156]">{form.meta_description || 'The meta description appears here.'}</div>
            </div>
          </div>
        </aside>

        <div className="space-y-6 lg:order-1">
          <Field label="Title" htmlFor="blog-title">
            <input id="blog-title" required value={form.title} onChange={(e) => onTitle(e.target.value)} maxLength={200} className={`${inputCls} font-display text-xl font-semibold`} />
          </Field>
          <Field label="Description" labelId="blog-desc-label" hint="The full article. Pasted text keeps its headings, lists and links.">
            <RichText labelledBy="blog-desc-label" value={form.description} onChange={(description) => set({ description })} />
          </Field>
          <Field label="Image" htmlFor="blog-image" hint="Shown at the top of the post, on the blog list and when the link is shared.">
            <ImageField url={form.image_url} onChange={(image_url) => set({ image_url })} onError={setError} />
          </Field>
        </div>
      </div>
    </form>
  );
}

// ---------- Panel ----------

export default function BlogAdmin() {
  const [auth, setAuth] = useState(blogSession.get() ? 'checking' : 'out'); // checking | out | in
  const [email, setEmail] = useState('');
  const [view, setView] = useState({ name: 'list' }); // list | edit
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const signOut = useCallback(() => {
    blogSession.clear();
    setAuth('out');
    setView({ name: 'list' });
    setPosts([]);
  }, []);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await blogAdminRequest('/posts');
      setPosts(data.posts);
    } catch (err) {
      if (err.status === 401) signOut();
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [signOut]);

  useEffect(() => {
    if (auth !== 'checking') return;
    blogAdminRequest('/me')
      .then((d) => { setEmail(d.email); setAuth('in'); })
      .catch(() => signOut());
  }, [auth, signOut]);

  useEffect(() => { if (auth === 'in') loadPosts(); }, [auth, loadPosts]);

  const remove = async (post) => {
    if (!window.confirm(`Delete "${post.title}"? It will be removed from the blog right away.`)) return;
    try {
      await blogAdminRequest(`/posts/${post.id}`, { method: 'DELETE' });
      setPosts((list) => list.filter((p) => p.id !== post.id));
    } catch (err) {
      if (err.status === 401) signOut();
      else setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <Helmet>
        <title>Blog admin | Waynur</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      {auth === 'checking' && (
        <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>
      )}

      {auth === 'out' && <LoginScreen onSignedIn={(e) => { setEmail(e); setAuth('in'); }} />}

      {auth === 'in' && (
        <>
          <header className="border-b border-border bg-white/70">
            <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
              <div className="flex items-center gap-3">
                <img src={logoFull} alt="Waynur" className="h-8 w-auto" />
                <span className="text-sm font-semibold text-ink">Blog admin</span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <a href="/blog" target="_blank" rel="noopener noreferrer" className="hidden items-center gap-1.5 text-ink-soft hover:text-ink sm:inline-flex">
                  Open blog <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <span className="hidden text-ink-soft md:inline">{email}</span>
                <button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 font-medium text-ink-soft hover:text-ink">
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            </div>
          </header>

          {view.name === 'list' ? (
            <PostList
              posts={posts}
              loading={loading}
              error={error}
              onNew={() => setView({ name: 'edit', id: null, key: Date.now() })}
              onEdit={(id) => setView({ name: 'edit', id, key: id })}
              onDelete={remove}
            />
          ) : (
            <Editor
              key={view.key}
              postId={view.id}
              onBack={() => { setView({ name: 'list' }); loadPosts(); }}
              onSaved={loadPosts}
              onSessionExpired={signOut}
            />
          )}
        </>
      )}
    </div>
  );
}
