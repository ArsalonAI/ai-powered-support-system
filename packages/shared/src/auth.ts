import { z } from 'zod';
import { Role } from './domain.js';

/**
 * The authentication wire contract. Both sides import these — the API parses
 * requests with them, the SPA types its session state off them.
 */

/**
 * No composition rules, only length. Rules like "one symbol, one digit" push
 * people toward `Password1!` and measurably weaken outcomes; strength scoring
 * and a breach check do the work instead — see `auth/password-policy.ts`.
 */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * argon2 cost does not grow with input length, but an unbounded field would let
 * an unauthenticated caller post megabytes at the login route.
 */
export const PASSWORD_MAX_LENGTH = 1024;

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254).email(),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * The logged-in user as the client sees it. Never carries a password hash —
 * the server selects an explicit field list rather than stripping one.
 */
export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: z.nativeEnum(Role),
  /**
   * Set by the bootstrap seed and by admin-initiated resets. Phase 3 surfaces
   * it; the set-password flow that clears it is task 4.7.
   */
  mustChangePassword: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/**
 * The body of `GET /api/auth/me` and `POST /api/auth/login`.
 *
 * The CSRF token rides along so a client that has a session always has a usable
 * token without a second round trip.
 */
export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  csrfToken: z.string(),
  /** ISO timestamp. The hard lifetime, which activity does not extend. */
  absoluteExpiresAt: z.string().datetime(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** `GET /api/auth/sessions` — 3.6's read side, over the caller's own sessions. */
export const sessionListResponseSchema = z.object({
  items: z.array(
    z.object({
      expiresAt: z.string().datetime(),
      current: z.boolean(),
    }),
  ),
});
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

/** The header `apiFetch` puts the CSRF token in. */
export const CSRF_HEADER = 'x-csrf-token';

/**
 * One message for every login failure — unknown email, wrong password, and
 * deactivated account are indistinguishable to the caller. Anything more
 * specific is an account-enumeration oracle.
 */
export const GENERIC_LOGIN_FAILURE = 'Invalid email or password';
