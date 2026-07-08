import jwt from 'jsonwebtoken';

// Verifies the JWT and attaches { teacher_id, school_id, role } to req.user.
// Every route that touches school data should sit behind this — it is what
// makes school_id trustworthy instead of taking it from the request body.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization bearer token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { teacher_id, school_id, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Restricts a route to principals only (e.g. petty-cash approval, analytics).
export function requirePrincipal(req, res, next) {
  if (!req.user || req.user.role !== 'principal') {
    return res.status(403).json({ error: 'Principal role required' });
  }
  next();
}
