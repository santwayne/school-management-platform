// In production this app and the API are served from the same domain
// (Vercel Services routes /api/* to the backend service) — so the correct
// default there is a relative path, not localhost. localhost:5000 is only
// right for local development, where Vite's import.meta.env.DEV is true.
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '');

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const AUTH_ENDPOINT_RE = /\/api\/(auth\/login|auth\/student-login|auth\/refresh|super-admin\/login)$/;

// A single in-flight refresh is shared by every request that hits a 401 at
// the same time, so a page that fires several requests right as the access
// token expires doesn't burn through several refresh-token rotations (each
// of which invalidates the previous one) for what is really one renewal.
let refreshPromise = null;

function refreshAccessToken() {
  const storedRefreshToken = localStorage.getItem('refreshToken');
  if (!storedRefreshToken) return Promise.resolve(false);

  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: storedRefreshToken }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return false;
        localStorage.setItem('token', data.token);
        localStorage.setItem('refreshToken', data.refreshToken);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// QA fix (T-1): a missing/expired token produced a 401 with a body like
// {"error":"Missing Authorization bearer token"} — every caller just threw
// that as a generic Error and rendered it in whatever error banner it had,
// so the user saw raw backend text instead of being bounced to /login. Any
// 401 now clears the stale session and does a hard redirect there, which
// works from this plain module (no AuthContext/router access) and matches
// the "any 401 should always redirect to /login" baseline regardless of
// which component's request hit it. Skipped on the login endpoints
// themselves, where a 401 is an expected "wrong password" response, not an
// expired session.
function handleUnauthorized(path) {
  if (AUTH_ENDPOINT_RE.test(path) || window.location.pathname === '/login') return;
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  window.location.assign('/login');
}

// QA fix (Group 4 / S-2, S-3): both reports describe the exact same
// fingerprint — a submit that silently does nothing (no reply, no new row,
// no visible error) with no request showing up server-side, where an
// immediate retry then works fine. That shape matches a dropped connection
// attempt (fetch() itself rejecting — a transient network blip, not an
// HTTP error response) rather than anything in the request-building code
// here or in the calling components, which already await correctly. A
// single automatic retry on that specific failure mode turns "silently
// broken, needs a manual retry" into "just works" without masking any real
// HTTP error (4xx/5xx responses are untouched and still surface normally).
async function fetchWithRetry(url, options) {
  try {
    return await fetch(url, options);
  } catch (networkErr) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return fetch(url, options);
  }
}

// A 401 on anything other than the login/refresh endpoints themselves means
// "your access token expired," not "you're logged out" — try one silent
// refresh-and-retry before falling back to the hard redirect-to-login that
// handleUnauthorized does. `_retried` caps this at one attempt per call so
// a refresh token that's itself invalid can't loop.
export async function apiRequest(path, { method = 'GET', body } = {}, _retried = false) {
  const res = await fetchWithRetry(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !_retried && !AUTH_ENDPOINT_RE.test(path)) {
    if (await refreshAccessToken()) return apiRequest(path, { method, body }, true);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function apiUpload(path, formData, _retried = false) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { ...authHeaders() }, // no Content-Type — browser sets multipart boundary
    body: formData,
  });

  if (res.status === 401 && !_retried) {
    if (await refreshAccessToken()) return apiUpload(path, formData, true);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return data;
}

// Downloads a file from an authenticated endpoint (payslip/certificate PDFs,
// the payroll bank CSV, ...). A plain <a href="/api/..."> can't work for
// these — browser navigation never sends the stored Bearer token, so every
// such link was silently hitting a 401 instead of the file. This fetches
// with the same auth (and the same silent-refresh-on-401 as apiRequest)
// and hands the browser a same-origin blob: URL to save instead.
export async function apiDownload(path, filename, _retried = false) {
  const res = await fetch(`${API_URL}${path}`, { headers: { ...authHeaders() } });

  if (res.status === 401 && !_retried) {
    if (await refreshAccessToken()) return apiDownload(path, filename, true);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) handleUnauthorized(path);
    throw new Error(data.error || `Download failed (${res.status})`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { API_URL };
