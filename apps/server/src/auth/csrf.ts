import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { CSRF_HEADER } from '@support/shared';
import { ApiError } from '../http/api-error.js';

/**
 * Task 3.9 — a synchronizer token, minted with the session and held in the
 * session row.
 *
 * This is the tax for cookie sessions: the browser attaches the cookie to any
 * request it makes, including one another site caused. `SameSite=Lax` blocks
 * the common form of that and is the reason this is defence in depth rather
 * than the only line — but "not sufficient alone" is the tech stack's wording,
 * and Lax still permits top-level GET navigations and does nothing for a
 * same-site subdomain.
 *
 * A synchronizer token rather than double-submit: the session row already
 * exists and is already server-side, so there is no reason to keep the
 * authoritative copy anywhere the client can write to.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Login is exempt, and has to be.
 *
 * A synchronizer token is bound to a session, and logging in is the request
 * that decides which session you get — there is no token to have brought. The
 * case this exemption actually covers is someone who *does* hold a session
 * posting to login again: signing in as a different user, or re-authenticating
 * after the client lost its token. Without the exemption that request is a 403,
 * which reads as "your password is fine but you may not sign in", and the fix
 * users find is clearing cookies.
 *
 * What is given up is login CSRF — an attacker silently signing a victim into
 * an account the attacker controls. `SameSite=Lax` is what covers it: the
 * browser does not attach this cookie to a cross-site POST at all.
 */
const EXEMPT_PATHS = new Set(['/api/auth/login']);

/**
 * Express routes case-insensitively and ignores a trailing slash by default, so
 * `/api/auth/Login` and `/api/auth/login/` both reach the login handler. An
 * exact-string exemption would not cover them, and the caller would get a 403
 * on a request whose credentials are fine.
 *
 * This only ever fails closed — the mismatch cannot be used to *skip* the check
 * — but "your password is right and you still may not sign in" is the kind of
 * error whose fix people find by clearing cookies.
 */
function normalizePath(path: string): string {
  return path.replace(/\/+$/, '').toLowerCase() || '/';
}

/**
 * Mints the token if this session does not have one yet, and returns it. Called
 * at login, and by `GET /api/auth/me` so a client that reloaded mid-session can
 * recover its token without logging in again.
 */
export function ensureCsrfToken(req: Request): string {
  req.session.csrfToken ??= randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

/** Constant-time, and length-safe: `timingSafeEqual` throws on a length mismatch. */
function tokensMatch(expected: string, provided: string): boolean {
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  return timingSafeEqual(a, b);
}

/**
 * Rejects state-changing requests that do not carry the session's token.
 *
 * Requests with no established session pass through untouched — there is no
 * token to check and nothing to protect, and `requireAuth` rejects them a
 * moment later anyway.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (
    SAFE_METHODS.has(req.method) ||
    EXEMPT_PATHS.has(normalizePath(req.path)) ||
    !req.session.userId
  ) {
    next();
    return;
  }

  const expected = req.session.csrfToken;
  const provided = req.get(CSRF_HEADER);

  if (!expected || !provided || !tokensMatch(expected, provided)) {
    throw ApiError.forbidden('Missing or invalid CSRF token');
  }

  next();
};
