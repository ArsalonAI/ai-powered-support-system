import { useState } from 'react';
import { TicketTable } from '../features/tickets/TicketTable';
import {
  DEFAULT_QUERY,
  useAgents,
  useTickets,
  type TicketQuery,
} from '../features/tickets/queries';

const STATUSES = ['OPEN', 'RESOLVED', 'CLOSED'];
const WAITING_ON = ['US', 'CUSTOMER'];
const CATEGORIES = [
  ['TECHNICAL_QUESTION', 'Technical'],
  ['REFUND_REQUEST', 'Refund'],
  ['GENERAL_QUESTION', 'General'],
] as const;
const SORTS = [
  ['oldest', 'Oldest first'],
  ['newest', 'Newest first'],
  ['recently_updated', 'Recently updated'],
] as const;

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
      {label}
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

export function TicketsPage() {
  const [query, setQuery] = useState<TicketQuery>(DEFAULT_QUERY);
  const { data, isPending, isError, error } = useTickets(query);
  const { data: agents } = useAgents();

  // Any filter change returns to page 1 — otherwise a narrower filter lands you
  // on a page that no longer exists and the table looks empty.
  const update = (patch: TicketQuery) => setQuery((current) => ({ ...current, ...patch, page: 1 }));

  const pageInfo = data?.pageInfo;
  const isDefaultView =
    query.status === 'OPEN' && query.waitingOn === 'US' && query.sort === 'oldest';

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tickets</h1>
          <p className="text-sm text-slate-500">
            {isDefaultView
              ? 'Open and waiting on us, oldest first — everything that needs a human, in the order it should be handled.'
              : 'Filtered view.'}
          </p>
        </div>
        {!isDefaultView && (
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => setQuery(DEFAULT_QUERY)}
          >
            Back to the default queue
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <Select label="Status" value={query.status ?? ''} onChange={(v) => update({ status: v })}>
          <option value="">Any</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </Select>

        <Select
          label="Waiting on"
          value={query.waitingOn ?? ''}
          onChange={(v) => update({ waitingOn: v })}
        >
          <option value="">Any</option>
          {WAITING_ON.map((w) => (
            <option key={w} value={w}>
              {w.toLowerCase()}
            </option>
          ))}
        </Select>

        <Select
          label="Category"
          value={query.category ?? ''}
          onChange={(v) => update({ category: v })}
        >
          <option value="">Any</option>
          {CATEGORIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select
          label="Assignee"
          value={query.unassigned ? 'unassigned' : (query.assigneeId ?? '')}
          onChange={(v) =>
            update(
              v === 'unassigned'
                ? { unassigned: true, assigneeId: undefined }
                : { unassigned: undefined, assigneeId: v || undefined },
            )
          }
        >
          <option value="">Anyone</option>
          <option value="unassigned">Unclaimed</option>
          {agents?.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </Select>

        <Select label="Sort" value={query.sort ?? 'oldest'} onChange={(v) => update({ sort: v })}>
          {SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {isError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not load tickets: {error instanceof Error ? error.message : 'unknown error'}
        </p>
      )}

      {isPending ? (
        <p className="px-4 py-10 text-center text-sm text-slate-500">Loading…</p>
      ) : (
        data && <TicketTable tickets={data.items} />
      )}

      {pageInfo && pageInfo.totalItems > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            {pageInfo.totalItems} ticket{pageInfo.totalItems === 1 ? '' : 's'} · page{' '}
            {pageInfo.page} of {pageInfo.totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
              disabled={pageInfo.page <= 1}
              onClick={() => setQuery((c) => ({ ...c, page: (c.page ?? 1) - 1 }))}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
              disabled={pageInfo.page >= pageInfo.totalPages}
              onClick={() => setQuery((c) => ({ ...c, page: (c.page ?? 1) + 1 }))}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
