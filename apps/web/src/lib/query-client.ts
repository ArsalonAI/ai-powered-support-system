import { QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './api-client';

export function createQueryClient(): QueryClient {
  return new QueryClient({
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
}
