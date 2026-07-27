import {
  assigneeRequestSchema,
  categoryRequestSchema,
  closeRequestSchema,
  replyRequestSchema,
  ticketListQuerySchema,
} from '@support/shared';
import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../../auth/current-user.js';
import { enqueueJob, hasJobInFlight } from '../../jobs/job-queue.js';
import { getTicketByNumber, listTickets } from '../../tickets/ticket-service.js';
import {
  appendOutboundMessage,
  closeTicket,
  reopenTicket,
  resolveTicket,
  setAssignee,
  setTicketCategory,
  type Actor,
} from '../../tickets/transition-service.js';
import { ApiError } from '../api-error.js';
import { parseBody, parseParams, parseQuery } from '../validate.js';

/**
 * The ticket domain over HTTP.
 *
 * Reads go to `ticket-service`; **every write goes to `transition-service`** and
 * never to a raw `prisma.ticket.update`, so the legality check and the audit
 * entry cannot be skipped by adding a route here.
 *
 * The write routes are shaped as intents — resolve, reply, claim — rather than
 * as a PATCH over ticket columns. There is deliberately no way to set `status`
 * directly, because that is the thing the state machine exists to govern.
 *
 * This whole router is mounted behind `requireAuth` in `app.ts`, so every
 * handler here has an authenticated user — task 3.13 moved these call sites off
 * the temporary 2.1 seam and onto the session, and this is where that landed.
 */
export const ticketsRouter: Router = Router();

const ticketNumberParams = z.object({
  number: z.coerce.number().int().positive(),
});

/** The logged-in user, in the shape the transition service records actors in. */
function actorFor(req: Request): Extract<Actor, { type: 'USER' }> {
  return { type: 'USER', userId: currentUser(req).id };
}

// --- Reads -----------------------------------------------------------------

ticketsRouter.get('/tickets', async (req, res) => {
  const query = parseQuery(ticketListQuerySchema, req);
  res.json(await listTickets(query));
});

ticketsRouter.get('/tickets/:number', async (req, res) => {
  const { number } = parseParams(ticketNumberParams, req);

  const ticket = await getTicketByNumber(number);
  if (!ticket) {
    throw ApiError.notFound(`No ticket with number ${number}`);
  }

  res.json(ticket);
});

// --- Writes ----------------------------------------------------------------

ticketsRouter.post('/tickets/:number/reply', async (req, res) => {
  const { number } = parseParams(ticketNumberParams, req);
  const body = parseBody(replyRequestSchema, req);
  const actor = actorFor(req);

  await appendOutboundMessage({
    ref: { number },
    actor,
    bodyText: body.bodyText,
    subject: body.subject ?? null,
    aiDrafted: body.aiDrafted,
    aiDraftEdited: body.aiDraftEdited ?? null,
  });

  // The whole ticket, so the client re-renders the thread from one response
  // rather than guessing what the transition changed.
  res.status(201).json(await getTicketByNumber(number));
});

ticketsRouter.post('/tickets/:number/resolve', async (req, res) => {
  const { number } = parseParams(ticketNumberParams, req);
  await resolveTicket({ ref: { number }, actor: actorFor(req) });
  res.json(await getTicketByNumber(number));
});

ticketsRouter.post('/tickets/:number/close', async (req, res) => {
  const { number } = parseParams(ticketNumberParams, req);
  const body = parseBody(closeRequestSchema, req);
  await closeTicket({ ref: { number }, actor: actorFor(req), reason: body.reason });
  res.json(await getTicketByNumber(number));
});

ticketsRouter.post('/tickets/:number/reopen', async (req, res) => {
  const { number } = parseParams(ticketNumberParams, req);
  await reopenTicket({ ref: { number }, actor: actorFor(req) });
  res.json(await getTicketByNumber(number));
});

ticketsRouter.patch('/tickets/:number/assignee', async (req, res) => {
  const { number } = parseParams(ticketNumberParams, req);
  const body = parseBody(assigneeRequestSchema, req);
  await setAssignee({ ref: { number }, actor: actorFor(req), assigneeId: body.assigneeId });
  res.json(await getTicketByNumber(number));
});

/**
 * Queue a summary (task 5.9). The *worker* writes it — this route only asks.
 *
 * 202, not 201: nothing has been created on the ticket yet, and the client
 * polls `summaryState` until the worker gets there. Answering 200 with an
 * unchanged ticket would read as "done".
 *
 * Re-summarizing is allowed and expected — a thread that has grown since the
 * last summary deserves a new one. What is not allowed is stacking a second job
 * on top of one already in flight, which is a double-click, not an intent.
 */
ticketsRouter.post('/tickets/:number/summarize', async (req, res) => {
  const { number } = parseParams(ticketNumberParams, req);

  const ticket = await getTicketByNumber(number);
  if (!ticket) {
    throw ApiError.notFound(`No ticket with number ${number}`);
  }

  // Deliberately a query rather than the `dedupeKey` column: that key is unique
  // forever, so using it here would make the first summary the only one this
  // ticket could ever have. It belongs to Gmail ingest (task 6.5).
  if (!(await hasJobInFlight('SUMMARIZE_TICKET', ticket.id))) {
    await enqueueJob({ type: 'SUMMARIZE_TICKET', ticketId: ticket.id });
  }

  // Re-read, so the response carries the state the enqueue just produced.
  res.status(202).json(await getTicketByNumber(number));
});

ticketsRouter.patch('/tickets/:number/category', async (req, res) => {
  const { number } = parseParams(ticketNumberParams, req);
  const body = parseBody(categoryRequestSchema, req);
  await setTicketCategory({ ref: { number }, actor: actorFor(req), category: body.category });
  res.json(await getTicketByNumber(number));
});
