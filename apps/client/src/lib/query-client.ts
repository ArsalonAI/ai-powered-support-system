import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './api-client';
import { setCsrfToken } from './csrf';

/**
 * Global 401 handling (task 3.11) lives here rather than in each caller.
 *
 * Sessions end while a tab is open — the absolute lifetime elapses, an admin
 * deactivates the account, someone signs out everywhere. Every one of those
 * surfaces as a 401 on whatever request happens to be next, and the alternative
 * to handling it centrally is every query and every mutation growing its own
 * "was that a 401?" branch, with the ones that forget silently rendering an
 * error where a login screen belongs.
 */

const SESSION_KEY = ['session'] as const;

function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

export function createQueryClient(): QueryClient {
  /**
   * The caches need to reach the client they belong to, and the client needs
   * the caches at construction — so the handler closes over a box that is
   * filled in immediately below. Nothing can fire an error before then.
   */
  const box: { client?: QueryClient } = {};

  const onError = (error: unknown): void => {
    if (!isUnauthenticated(error)) return;
    // Marking the session `null` is all it takes: the route guard reads the
    // same key and moves to the login page on the next render.
    setCsrfToken(null);
    box.client?.setQueryData(SESSION_KEY, null);
  };

  const client = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Never retry a request the server rejected on its merits — only
          // transport failures and 5xx are worth a second attempt.
          if (error instanceof ApiClientError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });

  box.client = client;
  return client;
}
