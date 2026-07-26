import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  apiErrorSchema,
  assigneeRequestSchema,
  categoryRequestSchema,
  closeRequestSchema,
  customerSummarySchema,
  healthResponseSchema,
  messageSchema,
  pageInfoSchema,
  relatedTicketSchema,
  replyRequestSchema,
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

/** Shared by every write path: the ticket is addressed by its human-facing number. */
const numberParam = z.object({
  number: z.coerce
    .number()
    .int()
    .positive()
    .openapi({ param: { name: 'number', in: 'path' }, example: 1 }),
});

const writeResponses = {
  404: json('No ticket with that number', ApiError),
  409: json(
    'Illegal transition — most often an attempt to act on a CLOSED ticket, which is terminal',
    ApiError,
  ),
  ...errorResponses,
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

// --- Writes ----------------------------------------------------------------
//
// Shaped as intents, not as a PATCH over ticket columns: there is no way to set
// `status` directly, because that is what the transition service governs. Every
// one of these writes an audit event.
//
// Until Phase 3 the acting user comes from the `x-acting-user` header (task
// 2.1). Omit it and the reply is attributed to the first seeded agent by name.

const actingUserHeader = z.object({
  'x-acting-user': z
    .string()
    .uuid()
    .optional()
    .openapi({
      param: { name: 'x-acting-user', in: 'header' },
      description:
        'TEMPORARY (task 2.1, removed at 3.13). The user id to attribute this write to — see GET /users. Defaults to the first active agent by name.',
    }),
});

registry.registerPath({
  method: 'post',
  path: '/tickets/{number}/reply',
  tags: ['Tickets'],
  summary: 'Reply to a ticket',
  description:
    'Persists an outbound message and hands the conversation back: `waitingOn` becomes CUSTOMER and the ticket drops out of the default queue without anyone resolving it. Replying to a RESOLVED ticket reopens it. Sending the mail itself arrives at task 6.9.',
  request: {
    params: numberParam,
    headers: actingUserHeader,
    body: { content: { 'application/json': { schema: replyRequestSchema } } },
  },
  responses: {
    201: json('The updated ticket, including the new message', TicketDetail),
    ...writeResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/tickets/{number}/resolve',
  tags: ['Tickets'],
  summary: 'Resolve a ticket',
  description: 'Answered and believed complete. Still reopenable by a customer reply.',
  request: { params: numberParam, headers: actingUserHeader },
  responses: { 200: json('The resolved ticket', TicketDetail), ...writeResponses },
});

registry.registerPath({
  method: 'post',
  path: '/tickets/{number}/close',
  tags: ['Tickets'],
  summary: 'Close a ticket',
  description:
    'Terminal. Normally reached by the 14-day sweep; done by hand for spam and duplicates. A later customer reply opens a new cross-linked ticket rather than reopening this one.',
  request: {
    params: numberParam,
    headers: actingUserHeader,
    body: { content: { 'application/json': { schema: closeRequestSchema } } },
  },
  responses: { 200: json('The closed ticket', TicketDetail), ...writeResponses },
});

registry.registerPath({
  method: 'post',
  path: '/tickets/{number}/reopen',
  tags: ['Tickets'],
  summary: 'Reopen a resolved ticket',
  description: 'RESOLVED → OPEN. A CLOSED ticket cannot be reopened.',
  request: { params: numberParam, headers: actingUserHeader },
  responses: { 200: json('The reopened ticket', TicketDetail), ...writeResponses },
});

registry.registerPath({
  method: 'patch',
  path: '/tickets/{number}/assignee',
  tags: ['Tickets'],
  summary: 'Claim or unclaim a ticket',
  description:
    'Assignment is optional and never restrictive — any agent can still act on any ticket. Null unclaims.',
  request: {
    params: numberParam,
    headers: actingUserHeader,
    body: { content: { 'application/json': { schema: assigneeRequestSchema } } },
  },
  responses: { 200: json('The updated ticket', TicketDetail), ...writeResponses },
});

registry.registerPath({
  method: 'patch',
  path: '/tickets/{number}/category',
  tags: ['Tickets'],
  summary: 'Set or correct the category',
  description:
    'Leaves `aiCategory` untouched: the gap between what the classifier said and what an agent chose is the labeled eval data the Phase 5 accuracy gate measures against.',
  request: {
    params: numberParam,
    headers: actingUserHeader,
    body: { content: { 'application/json': { schema: categoryRequestSchema } } },
  },
  responses: { 200: json('The updated ticket', TicketDetail), ...writeResponses },
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
