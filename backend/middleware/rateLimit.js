import rateLimit from 'express-rate-limit';

// Login is the classic credential-stuffing / brute-force target — tight
// limit, keyed by IP. 20 attempts / 15 min is generous for a real user who
// mistypes a password a few times, but shuts down automated guessing.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — please wait a few minutes and try again.' },
});

// Onboarding (school/account creation) is cheaper to abuse for spam/DoS
// than login, but still worth capping per IP.
export const onboardingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts from this network — please try again later.' },
});

// The WhatsApp webhook is publicly reachable by design (Meta calls it), so
// this can't be an IP-based user-facing limiter in the same sense — but an
// unbounded rate here is still a DoS vector against downstream AI/DB calls,
// so cap overall throughput generously rather than leaving it wide open.
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
});
