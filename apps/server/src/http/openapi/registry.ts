import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  apiErrorSchema,
  customerSummarySchema,
  healthResponseSchema,
  messageSchema,
  pageInfoSchema,
  relatedTicketSchema,
  statsResponseSchema,
  ticketDetailSchema,
  ticketListQuerySchema,
  ticketListResponseSchema,
  ticketSummarySchema,
  userListResponseSchema,
  userSummarySchema,
} from '@support/shared';
import { z } from 'zod';

// Adds `.openapi()` to Zod's prototype. Must run before any schema is registered.
extendZodWithOpenApi(z);

export const registry: OpenAPIRegistry = new OpenAPIRegistry();

// Registered so they appear as named components and are referenced by $ref
// from the response schemas below, rather than being inlined at each use.
registry.register('PageInfo', pageInfoSchema);
registry.register('UserSummary', userSummarySchema);
registry.register('CustomerSummary', customerSummarySchema);
registry.register('Message', messageSchema);
registry.register('RelatedTicket', relatedTicketSchema);
registry.register('TicketSummary', ticketSummarySchema);

// Referenced directly by the paths below.
const ApiError = registry.register('ApiError', apiErrorSchema);
const TicketDetail = registry.register('TicketDetail', ticketDetailSchema);
const TicketListResponse = registry.register('TicketListResponse', ticketListResponseSchema);
const UserListResponse = registry.register('UserListResponse', userListResponseSchema);
const StatsResponse = registry.register('StatsResponse', statsResponseSchema);
const HealthResponse = registry.register('HealthResponse', healthResponseSchema);

const json = <T>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});

const errorResponses = {
  422: json('Request validation failed', ApiError),
  500: json('Unexpected error', ApiError),
};

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Liveness and database connectivity',
  description:
    'The only route that stays public once authentication lands in Phase 3. Returns 503 when the database is unreachable.',
  responses: {
    200: json('Healthy', HealthResponse),
    503: json('Database unreachable', HealthResponse),
  },
});

registry.registerPath({
  method: 'get',
  path: '/tickets',
  tags: ['Tickets'],
  summary: 'List tickets',
  description:
    'Filtered, sorted, server-side paginated. The default agent queue is `status=OPEN&waitingOn=US&sort=oldest` — everything needing a human, in the order it should be handled.',
  request: { query: ticketListQuerySchema },
  responses: {
    200: json('A page of tickets', TicketListResponse),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/tickets/{number}',
  tags: ['Tickets'],
  summary: 'Get one ticket by its human-facing number',
  description:
    'Includes the full message thread, the customer, their other tickets, and — when this ticket continues a closed one — a cross-link to the original.',
  request: {
    params: z.object({
      number: z.coerce
        .number()
        .int()
        .positive()
        .openapi({ param: { name: 'number', in: 'path' }, example: 1 }),
    }),
  },
  responses: {
    200: json('The ticket', TicketDetail),
    404: json('No ticket with that number', ApiError),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/users',
  tags: ['Users'],
  summary: 'List internal users',
  description:
    'Agents and admins, for assignment and the assignee filter. Never includes password hashes.',
  responses: {
    200: json('All users', UserListResponse),
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/stats',
  tags: ['System'],
  summary: 'Queue and AI adoption figures',
  description:
    'Adoption is derived from the per-message aiDrafted/aiDraftEdited flags — the durable record the Phase 7 dashboard queries, which cannot be reconstructed after the fact.',
  responses: {
    200: json('Current figures', StatsResponse),
    ...errorResponses,
  },
});
