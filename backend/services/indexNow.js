// IndexNow: tells Bing (which feeds ChatGPT search), Yandex and others that a
// URL changed, so new/edited posts are picked up in minutes, not weeks.
// Set INDEXNOW_KEY (32 hex chars) on the server and put <key>.txt containing
// the key in frontend/public/. Does nothing if the key is not set.
const SITE = (process.env.PUBLIC_SITE_URL || 'https://waynur.com').replace(/\/+$/, '');

export async function pingIndexNow(paths) {
  const key = process.env.INDEXNOW_KEY;
  if (!key || process.env.NODE_ENV === 'test') return;
  const host = new URL(SITE).host;
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${SITE}/${key}.txt`,
        urlList: paths.map((p) => `${SITE}${p}`),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok && res.status !== 202) console.warn(`IndexNow ping returned ${res.status}`);
  } catch (err) {
    console.warn('IndexNow ping failed:', err.message);
  }
}
