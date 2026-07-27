/**
 * The CSRF token for the current session, held in module state.
 *
 * `apiFetch` is a plain function rather than a hook, so it cannot read React
 * state. The token is written whenever a session response arrives — from login
 * and from `GET /auth/me` — and read on every state-changing request.
 *
 * Deliberately **not** in `localStorage`. The token is a property of the
 * session, not of the browser: persisting it would outlive the session it
 * belongs to and the first write after a logout would fail with a 403 that
 * looks like a bug rather than like a sign-out.
 */

let csrfToken: string | null = null;

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}
