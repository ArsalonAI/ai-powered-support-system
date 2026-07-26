import { ticketListQuerySchema } from '@support/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getTicketByNumber, listTickets } from '../../tickets/ticket-service.js';
import { ApiError } from '../api-error.js';
import { parseParams, parseQuery } from '../validate.js';

/**
 * Read side of the ticket domain, arriving ahead of Phase 2 so the seeded
 * corpus is inspectable. Writes and status transitions are not here and must
 * not be added here — they go through the Phase 2 transition service.
 *
 * Phase 3 wraps this router in `requireAuth`; nothing else about it changes.
 */
export const ticketsRouter: Router = Router();

const ticketNumberParams = z.object({
  number: z.coerce.number().int().positive(),
});

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
