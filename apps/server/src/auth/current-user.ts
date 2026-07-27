import type { SessionUser } from '@support/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../http/api-error.js';
import { ABSOLUTE_LIFETIME_MS } from './session.js';

/**
 * Task 3.10 — the gate every route except `/api/health` sits behind, and the
 * replacement for the temporary identity seam task 2.1 stood up.
 *
 * That seam was deleted at 3.13 rather than left behind a flag: a dev-only
 * header letting any caller act as any user is a backdoor once real sessions
 * exist. Everything that needs to know who is acting now reads
 * `req.currentUser`, which exists only because `requireAuth` put it there — a
 * handler cannot accidentally run without an identity, because it cannot reach
 * a request that has none.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Absent on `/api/health` and the login route. */
      currentUser?: SessionUser;
    }
  }
}

/** Never selects `passwordHash` — an explicit list, not a strip-after-the-fact. */
const sessionUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  mustChangePassword: true,
  isActive: true,
} as const;

/**
 * Ends the session on this request. Used when the cookie is valid but the
 * account behind it no longer is — a deactivated user's row is deleted at 4.3,
 * but a session that somehow survives must not keep working.
 */
function destroySession(req: Request): Promise<void> {
  return new Promise((resolve) => {
    req.session.destroy(() => resolve());
  });
}

/**
 * Loads the session's user from the database on every request rather than
 * trusting the copy in the session payload.
 *
 * That is one indexed primary-key lookup per request, and it is what makes a
 * role change or a deactivation take effect on the *next* request instead of
 * whenever the cookie happens to expire. At under 50 tickets a day the cost is
 * not worth optimising away.
 */
export const requireAuth: RequestHandler = (req, res, next) => {
  void authenticate(req, res, next);
};

async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, absoluteExpiresAt } = req.session;

    if (!userId) {
      throw ApiError.unauthenticated();
    }

    // 3.5's hard ceiling. `rolling` renews the idle window on every response, so
    // without this an active session would never end at all. A session with no
    // stamp predates the field and is treated as expired rather than immortal.
    if ((absoluteExpiresAt ?? 0) <= Date.now()) {
      await destroySession(req);
      throw ApiError.unauthenticated('Session expired, please sign in again');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: sessionUserSelect,
    });

    if (!user || !user.isActive) {
      await destroySession(req);
      throw ApiError.unauthenticated('This account is no longer active');
    }

    const { isActive: _isActive, ...sessionUser } = user;
    req.currentUser = sessionUser;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Role gate. Mounted per route rather than globally: most of the API is agent
 * work, and the admin surface (Phase 4) is the exception.
 *
 * Applied here rather than in Phase 4 on purpose — task 4.2's note asks that
 * authorization be an audit of existing routes, not a second retrofit.
 */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  const user = req.currentUser;
  if (!user) {
    // Reaching here without `requireAuth` in front is a wiring mistake, not a
    // caller error, so it must not read as "log in and try again".
    next(ApiError.internal('requireAdmin used without requireAuth'));
    return;
  }
  if (user.role !== 'ADMIN') {
    next(ApiError.forbidden('This action requires an admin account'));
    return;
  }
  next();
};

/**
 * The identity a write is attributed to. Throws rather than returning
 * `undefined`, so a handler mounted outside `requireAuth` fails loudly instead
 * of writing a NULL author the database would reject anyway.
 */
export function currentUser(req: Request): SessionUser {
  const user = req.currentUser;
  if (!user) {
    throw ApiError.internal('No authenticated user on this request');
  }
  return user;
}

/** The absolute-lifetime stamp, written once at login. Exported for the tests. */
export function absoluteExpiryFromNow(): number {
  return Date.now() + ABSOLUTE_LIFETIME_MS;
}
