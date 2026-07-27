import type { TicketDetail, TicketListResponse, UserSummary } from '@support/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api-client';

/** Mirrors the server's `ticketListQuerySchema`; every field is optional. */
export interface TicketQuery {
  status?: string;
  waitingOn?: string;
  category?: string;
  assigneeId?: string;
  unassigned?: boolean;
  sort?: string;
  page?: number;
  pageSize?: number;
}

/**
 * The default agent view, straight from the PRD: everything needing a human, in
 * the order it should be handled.
 */
export const DEFAULT_QUERY: TicketQuery = {
  status: 'OPEN',
  waitingOn: 'US',
  sort: 'oldest',
  page: 1,
};

function toSearchParams(query: TicketQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export function useTickets(query: TicketQuery) {
  const search = toSearchParams(query);
  return useQuery({
    queryKey: ['tickets', search],
    queryFn: ({ signal }) => apiFetch<TicketListResponse>(`/tickets?${search}`, { signal }),
    // Keeps the previous page on screen while the next one loads, so paging
    // does not flash an empty table.
    placeholderData: (previous) => previous,
  });
}

/** How often to re-check a ticket whose summary is still being written. */
const SUMMARY_POLL_MS = 2_000;

export function useTicket(number: number | undefined) {
  return useQuery({
    queryKey: ['ticket', number],
    queryFn: ({ signal }) => apiFetch<TicketDetail>(`/tickets/${number}`, { signal }),
    enabled: number !== undefined,
    /**
     * The summary is written by the worker, in another process — so unlike
     * every other write here, the result cannot arrive in a mutation response.
     * Poll while a job is in flight and stop as soon as it settles, rather than
     * polling this endpoint all the time.
     */
    refetchInterval: (query) => {
      const state = query.state.data?.summaryState;
      return state === 'PENDING' || state === 'RUNNING' ? SUMMARY_POLL_MS : false;
    },
  });
}

export function useAgents() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async ({ signal }) => {
      const response = await apiFetch<{ items: UserSummary[] }>('/users', { signal });
      return response.items;
    },
    // The roster changes rarely and is read on every ticket row for the
    // assignee column.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Every write returns the whole updated ticket, so the detail view re-renders
 * from the response rather than guessing what the transition changed. The list
 * is invalidated too: a resolve or a reply moves the ticket out of the default
 * queue, and leaving a stale row there would misrepresent the work remaining.
 */
function useTicketMutation<TBody>(number: number, path: string, method: 'POST' | 'PATCH' = 'POST') {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body?: TBody) =>
      apiFetch<TicketDetail>(`/tickets/${number}/${path}`, {
        method,
        ...(body === undefined ? {} : { body }),
      }),
    onSuccess: (ticket) => {
      queryClient.setQueryData(['ticket', number], ticket);
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export interface ReplyBody {
  bodyText: string;
  aiDrafted: boolean;
}

export const useReply = (number: number) => useTicketMutation<ReplyBody>(number, 'reply');
export const useResolve = (number: number) => useTicketMutation<never>(number, 'resolve');
export const useReopen = (number: number) => useTicketMutation<never>(number, 'reopen');
export const useClose = (number: number) => useTicketMutation<{ reason?: string }>(number, 'close');
export const useSetAssignee = (number: number) =>
  useTicketMutation<{ assigneeId: string | null }>(number, 'assignee', 'PATCH');
export const useSetCategory = (number: number) =>
  useTicketMutation<{ category: string }>(number, 'category', 'PATCH');
/**
 * Queues the summary; the worker writes it. The 202 response carries the ticket
 * with `summaryState` already PENDING, which is what starts `useTicket` polling.
 */
export const useSummarize = (number: number) => useTicketMutation<never>(number, 'summarize');
