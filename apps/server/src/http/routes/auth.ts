import {
  GENERIC_LOGIN_FAILURE,
  loginRequestSchema,
  type SessionResponse,
  type SessionUser,
} from '@support/shared';
import type { Request } from 'express';
import { Router } from 'express';
import { ensureCsrfToken } from '../../auth/csrf.js';
import { absoluteExpiryFromNow, currentUser, requireAuth } from '../../auth/current-user.js';
import { checkLoginRateLimit, recordLoginAttempt } from '../../auth/login-rate-limit.js';
import { fakeVerify, verifyPassword } from '../../auth/password.js';
import {
  listSessionsForUser,
  revokeSessionsForUser,
  stampSessionOwner,
} from '../../auth/session-registry.js';
import { prisma } from '../../db/prisma.js';
import { ApiError } from '../api-error.js';
import { parseBody } from '../validate.js';

/**
 * Tasks 3.4, 3.6, and 3.7 — the session's whole lifecycle.
 *
 * Login is the one route in the API that an unauthenticated caller may reach,
 * so it is also the only place where the enumeration and fixation defences have
 * anywhere to go wrong. Each one is a comment below because each of them fails
 * *silently*: the app works perfectly with all three broken.
 */
export const authRouter: Router = Router();

/** Promisified because express-session predates promises and these must be awaited in order. */
function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function sessionResponse(req: Request, user: SessionUser): SessionResponse {
  return {
    user,
    csrfToken: ensureCsrfToken(req),
    absoluteExpiresAt: new Date(req.session.absoluteExpiresAt ?? 0).toISOString(),
  };
}

authRouter.post('/auth/login', async (req, res) => {
  const { email, password } = parseBody(loginRequestSchema, req);
  // `trust proxy` is 0, so this is the socket address and cannot be spoofed
  // through `X-Forwarded-For`. If a proxy is ever added, TRUST_PROXY_HOPS is
  // what keeps this true — see the note in config/env.ts.
  const ip = req.ip ?? 'unknown';

  const limit = await checkLoginRateLimit({ email, ip });
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    throw new ApiError('RATE_LIMITED', 'Too many sign-in attempts. Try again shortly.');
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      mustChangePassword: true,
      isActive: true,
      passwordHash: true,
    },
  });

  /**
   * A hash runs on every attempt, including ones with no account behind them.
   * Returning early for an unknown email would make the response measurably
   * faster for addresses that do not exist, which is an enumeration oracle that
   * no amount of care with the *message* can close.
   */
  const passwordOk = user?.passwordHash
    ? await verifyPassword(user.passwordHash, password)
    : await fakeVerify();

  // Unknown email, wrong password, no password set yet, and deactivated account
  // are one outcome with one message. `isActive` is checked here rather than
  // earlier so that a deactivated account costs exactly as much as a live one.
  if (!user || !passwordOk || !user.isActive) {
    await recordLoginAttempt({ email, ip }, false);
    throw ApiError.unauthenticated(GENERIC_LOGIN_FAILURE);
  }

  await recordLoginAttempt({ email, ip }, true);

  /**
   * 3.4 — session fixation. An attacker who can plant a session ID in the
   * victim's browser before login otherwise holds a cookie that becomes
   * authenticated the moment the victim signs in. Regenerating issues a fresh
   * ID and destroys the old row, so the planted one authenticates nothing.
   *
   * It must happen *before* anything identifying is written into the session:
   * `regenerate` starts an empty session, and fields set beforehand are lost.
   */
  await regenerateSession(req);

  req.session.userId = user.id;
  // 3.5's hard ceiling, stamped once. Rolling renewal extends the idle window
  // on every response but never touches this.
  req.session.absoluteExpiresAt = absoluteExpiryFromNow();
  ensureCsrfToken(req);

  // The row must exist before it can be stamped with its owner.
  await saveSession(req);
  // 3.6 — what makes deactivation and password reset able to revoke.
  await stampSessionOwner(req.sessionID, user.id);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const { passwordHash: _passwordHash, isActive: _isActive, ...sessionUser } = user;
  res.json(sessionResponse(req, sessionUser));
});

/**
 * Behind `requireAuth`, so a caller without a session gets a 401 rather than a
 * cheerful 204 for having logged out of nothing.
 */
authRouter.post('/auth/logout', requireAuth, async (req, res) => {
  await destroySession(req);
  res.clearCookie('support.sid', { path: '/' });
  res.status(204).end();
});

authRouter.get('/auth/me', requireAuth, (req, res) => {
  res.json(sessionResponse(req, currentUser(req)));
});

/**
 * 3.6's read side. Own sessions only — the admin view over another user's
 * sessions belongs with the rest of user management in Phase 4.
 */
authRouter.get('/auth/sessions', requireAuth, async (req, res) => {
  const sessions = await listSessionsForUser(currentUser(req).id);
  res.json({
    items: sessions.map((session) => ({
      expiresAt: session.expiresAt.toISOString(),
      current: session.sid === req.sessionID,
    })),
  });
});

/**
 * Sign out everywhere else — the same revocation path deactivation (4.3) and
 * password reset (4.6) call, exercised by the person who owns the sessions.
 * This one keeps the caller's own session, which is the difference between
 * "drop the laptop I left at the office" and "log myself out".
 */
authRouter.post('/auth/logout-others', requireAuth, async (req, res) => {
  const revoked = await revokeSessionsForUser(currentUser(req).id, { exceptSid: req.sessionID });
  res.json({ revoked });
});
