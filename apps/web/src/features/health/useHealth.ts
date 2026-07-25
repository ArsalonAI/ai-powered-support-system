import type { HealthResponse } from '@support/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api-client';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => apiFetch<HealthResponse>('/health', { signal }),
    refetchInterval: 60_000,
  });
}
