// In production this app and the API are served from the same domain
// (Vercel Services routes /api/* to the backend service) — so the correct
// default there is a relative path, not localhost. localhost:5000 is only
// right for local development, where Vite's import.meta.env.DEV is true.
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '');

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  const isAuthEndpoint = /\/api\/(auth\/login|auth\/student-login|super-admin\/login)$/.test(path);
  if (isAuthEndpoint || window.location.pathname === '/login') return;
  localStorage.removeItem('token');
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

export async function apiRequest(path, { method = 'GET', body } = {}) {
  const res = await fetchWithRetry(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function apiUpload(path, formData) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { ...authHeaders() }, // no Content-Type — browser sets multipart boundary
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return data;
}

export { API_URL };
