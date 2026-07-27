import type { LoginRequest, SessionResponse } from '@support/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError, apiFetch } from '../../lib/api-client';
import { setCsrfToken } from '../../lib/csrf';

/**
 * The session, as the client sees it.
 *
 * `GET /auth/me` is the single source of truth — there is no copy of the user
 * in `localStorage` to go stale, and nothing the client believes about its own
 * session survives a rejection from the server. A deactivated agent's tab stops
 * working on its next request rather than looking signed in until they reload.
 */

export const SESSION_KEY = ['session'] as const;

/** `null` means "definitely signed out", as opposed to "not asked yet". */
export type Session = SessionResponse | null;

export function useSession() {
  return useQuery<Session>({
    queryKey: SESSION_KEY,
    queryFn: async ({ signal }) => {
      try {
        const session = await apiFetch<SessionResponse>('/auth/me', { signal });
        setCsrfToken(session.csrfToken);
        return session;
      } catch (error) {
        // A 401 here is the expected answer for a signed-out visitor, not a
        // failure: it resolves to `null` so the router can redirect instead of
        // rendering an error page over the login screen.
        if (error instanceof ApiClientError && error.status === 401) {
          setCsrfToken(null);
          return null;
        }
        throw error;
      }
    },
    // The session is checked on load and after a write fails, not on a timer.
    staleTime: Infinity,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: LoginRequest) =>
      apiFetch<SessionResponse>('/auth/login', { method: 'POST', body: credentials }),
    onSuccess: (session) => {
      setCsrfToken(session.csrfToken);
      queryClient.setQueryData<Session>(SESSION_KEY, session);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      // Settled rather than success: if the server already ended the session,
      // the client must not stay in a state that says otherwise.
      setCsrfToken(null);
      queryClient.setQueryData<Session>(SESSION_KEY, null);
      // Everything cached was read as this user. Nothing of it should be on
      // screen for whoever signs in next.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
    },
  });
}
