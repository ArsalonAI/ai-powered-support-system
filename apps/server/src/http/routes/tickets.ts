import {
  assigneeRequestSchema,
  categoryRequestSchema,
  closeRequestSchema,
  replyRequestSchema,
  ticketListQuerySchema,
} from '@support/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getActingUser } from '../../auth/acting-user.js';
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
 * Phase 3 wraps this whole router in `requireAuth`; until then `getActingUser`
 * (task 2.1) supplies the identity every write needs.
 */
export const ticketsRouter: Router = Router();

const ticketNumberParams = z.object({
  number: z.coerce.number().int().positive(),
});

/** Task 3.13 replaces this one line with the session user. */
async function actorFor(
  req: Parameters<typeof getActingUser>[0],
): Promise<Extract<Actor, { type: 'USER' }>> {
  const user = await getActingUser(req);
  return { type: 'USER', userId: user.id };
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
  const actor = await actorFor(req);

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
  await resolveTicket({ ref: { number }, actor: await actorFor(req) });
  res.json(await getTicketByNumber(number));
});

ticketsRouter.post('/tickets/:number/close', async (req, res) => {
  const { number } = parseParams(ticketNumberParams, req);
  const body = parseBody(closeRequestSchema, req);
  await closeTicket({ ref: { number }, actor: await actorFor(req), reason: body.reason });
  res.json(await getTicketByNumber(number));
});

ticketsRouter.post('/tickets/:number/reopen', async (req, res) => {
  const { number } = parseParams(ticketNumberParams, req);
  await reopenTicket({ ref: { number }, actor: await actorFor(req) });
  res.json(await getTicketByNumber(number));
});

ticketsRouter.patch('/tickets/:number/assignee', async (req, res) => {
  const { number } = parseParams(ticketNumberParams, req);
  const body = parseBody(assigneeRequestSchema, req);
  await setAssignee({ ref: { number }, actor: await actorFor(req), assigneeId: body.assigneeId });
  res.json(await getTicketByNumber(number));
});

ticketsRouter.patch('/tickets/:number/category', async (req, res) => {
  const { number } = parseParams(ticketNumberParams, req);
  const body = parseBody(categoryRequestSchema, req);
  await setTicketCategory({ ref: { number }, actor: await actorFor(req), category: body.category });
  res.json(await getTicketByNumber(number));
});
