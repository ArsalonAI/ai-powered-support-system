import type { TicketDetail } from '@support/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiClientError } from '../lib/api-client';
import { CategoryBadge, StatusBadge, WaitingOnBadge } from '../features/tickets/badges';
import {
  useAgents,
  useClose,
  useReopen,
  useReply,
  useResolve,
  useSetAssignee,
  useSetCategory,
  useTicket,
} from '../features/tickets/queries';

const CATEGORIES = [
  ['TECHNICAL_QUESTION', 'Technical question'],
  ['REFUND_REQUEST', 'Refund request'],
  ['GENERAL_QUESTION', 'General question'],
] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

/** The thread. Inbound is the customer; outbound always carries a named human. */
function Thread({ ticket }: { ticket: TicketDetail }) {
  return (
    <ol className="flex flex-col gap-3">
      {ticket.messages.map((message) => {
        const inbound = message.direction === 'INBOUND';
        return (
          <li
            key={message.id}
            className={`rounded-lg border p-4 ${
              inbound ? 'border-slate-200 bg-white' : 'border-blue-100 bg-blue-50/60'
            }`}
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-slate-700">
                {inbound
                  ? (ticket.customer.displayName ?? ticket.customer.email)
                  : (message.author?.name ?? 'Unknown agent')}
                <span className="ml-2 font-normal text-slate-400">
                  {inbound ? 'customer' : 'agent'}
                </span>
              </span>
              <span className="text-slate-400">{formatDate(message.occurredAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-800">{message.bodyText}</p>
            {message.aiDrafted && (
              <p className="mt-2 text-xs text-slate-500">
                Started as an AI draft ·{' '}
                {message.aiDraftEdited ? 'edited before sending' : 'sent as drafted'}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Persists a message; actually emailing it is task 6.9.
 *
 * `aiDrafted` is sent explicitly rather than defaulted. There are no AI drafts
 * until Phase 5, so it is always false here — but the flag is the accept/edit
 * signal the primary success metric is derived from and cannot be
 * reconstructed later, so the send path states it rather than omitting it.
 */
function Composer({ ticket }: { ticket: TicketDetail }) {
  const [body, setBody] = useState('');
  const reply = useReply(ticket.number);
  const closed = ticket.status === 'CLOSED';

  if (closed) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
        This ticket is closed. A customer reply on this thread will open a new, cross-linked ticket.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) return;
        reply.mutate({ bodyText: body, aiDrafted: false }, { onSuccess: () => setBody('') });
      }}
    >
      <label className="text-sm font-medium text-slate-700" htmlFor="reply">
        Reply
      </label>
      <textarea
        id="reply"
        className="min-h-32 rounded-md border border-slate-300 p-3 text-sm"
        placeholder="Write a reply…"
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Saved to the thread. Sending over email arrives in Phase 6.
        </p>
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          disabled={!body.trim() || reply.isPending}
        >
          {reply.isPending ? 'Saving…' : 'Save reply'}
        </button>
      </div>
      {reply.isError && <p className="text-sm text-red-700">{errorMessage(reply.error)}</p>}
    </form>
  );
}

function Sidebar({ ticket }: { ticket: TicketDetail }) {
  const { data: agents } = useAgents();
  const resolve = useResolve(ticket.number);
  const reopen = useReopen(ticket.number);
  const close = useClose(ticket.number);
  const setAssignee = useSetAssignee(ticket.number);
  const setCategory = useSetCategory(ticket.number);

  const closed = ticket.status === 'CLOSED';
  const busy =
    resolve.isPending ||
    reopen.isPending ||
    close.isPending ||
    setAssignee.isPending ||
    setCategory.isPending;
  const actionError =
    resolve.error ?? reopen.error ?? close.error ?? setAssignee.error ?? setCategory.error;

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 text-sm">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">State</h2>
        <dl className="flex flex-col gap-2">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Status</dt>
            <dd>
              <StatusBadge status={ticket.status} />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Waiting on</dt>
            <dd>
              <WaitingOnBadge waitingOn={ticket.waitingOn} />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Category</dt>
            <dd>
              <CategoryBadge
                category={ticket.category}
                classificationState={ticket.classificationState}
              />
            </dd>
          </div>
        </dl>
      </section>

      {!closed && (
        <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</h2>

          <div className="flex flex-wrap gap-2">
            {ticket.status === 'OPEN' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => resolve.mutate(undefined)}
                className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-40"
              >
                Resolve
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => reopen.mutate(undefined)}
                className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-40"
              >
                Reopen
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => close.mutate({ reason: 'closed by agent' })}
              className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              Close
            </button>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Assignee
            <select
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              value={ticket.assignee?.id ?? ''}
              disabled={busy}
              onChange={(event) => setAssignee.mutate({ assigneeId: event.target.value || null })}
            >
              <option value="">Unclaimed</option>
              {agents?.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Category
            <select
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              value={ticket.category ?? ''}
              disabled={busy}
              onChange={(event) => setCategory.mutate({ category: event.target.value })}
            >
              <option value="" disabled>
                Choose…
              </option>
              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {actionError && <p className="text-sm text-red-700">{errorMessage(actionError)}</p>}
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Customer
        </h2>
        <p className="font-medium text-slate-800">
          {ticket.customer.displayName ?? ticket.customer.email}
        </p>
        <p className="text-slate-500">{ticket.customer.email}</p>

        {/* History spans tickets — the difference between a support inbox and a CRM. */}
        {ticket.customerHistory.length > 0 && (
          <>
            <h3 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Earlier tickets
            </h3>
            <ul className="flex flex-col gap-1">
              {ticket.customerHistory.map((related) => (
                <li key={related.id}>
                  <Link
                    to={`/tickets/${related.number}`}
                    className="text-slate-600 hover:text-blue-700 hover:underline"
                  >
                    #{related.number} {related.subject}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </aside>
  );
}

export function TicketDetailPage() {
  const params = useParams();
  const number = Number(params.number);
  const {
    data: ticket,
    isPending,
    isError,
    error,
  } = useTicket(Number.isFinite(number) ? number : undefined);

  if (isPending) return <p className="py-10 text-center text-sm text-slate-500">Loading…</p>;

  if (isError || !ticket) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-red-800">{errorMessage(error)}</p>
        <Link to="/tickets" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
          Back to the queue
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <Link to="/tickets" className="text-sm text-slate-500 hover:text-slate-900">
          ← Queue
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          <span className="text-slate-400">#{ticket.number}</span> {ticket.subject}
        </h1>
        {ticket.previousTicket && (
          <p className="mt-1 text-sm text-slate-500">
            Continues{' '}
            <Link
              to={`/tickets/${ticket.previousTicket.number}`}
              className="text-blue-700 hover:underline"
            >
              #{ticket.previousTicket.number}
            </Link>
            , which was closed.
          </p>
        )}
        {ticket.flaggedForResearch && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Flagged for research — the knowledge base did not support a draft.
          </p>
        )}
      </header>

      <div className="flex gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {ticket.summary && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <span className="font-medium">Summary · </span>
              {ticket.summary}
            </p>
          )}
          <Thread ticket={ticket} />
          <Composer ticket={ticket} />
        </div>
        <Sidebar ticket={ticket} />
      </div>
    </div>
  );
}
