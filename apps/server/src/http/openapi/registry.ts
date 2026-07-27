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
  loginRequestSchema,
  replyRequestSchema,
  sessionListResponseSchema,
  sessionResponseSchema,
  sessionUserSchema,
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
registry.register('SessionUser', sessionUserSchema);

// Referenced directly by the paths below.
const ApiError = registry.register('ApiError', apiErrorSchema);
const SessionResponse = registry.register('SessionResponse', sessionResponseSchema);
const SessionListResponse = registry.register('SessionListResponse', sessionListResponseSchema);
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
  401: json('No session, an expired one, or an account that is no longer active', ApiError),
  403: json('Missing or invalid CSRF token, or an admin-only route', ApiError),
  422: json('Request validation failed', ApiError),
  500: json('Unexpected error', ApiError),
};

/**
 * Every state-changing request carries this. Declared here rather than beside
 * the ticket writes because the auth paths below need it too.
 */
const csrfHeader = z.object({
  'x-csrf-token': z.string().openapi({
    param: { name: 'x-csrf-token', in: 'header', required: true },
    description:
      'The token from POST /auth/login or GET /auth/me. Required on every state-changing request; missing or wrong is a 403.',
  }),
});

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

// --- Auth ------------------------------------------------------------------

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['Auth'],
  summary: 'Sign in',
  description:
    'The only route besides /health that does not require a session. Regenerates the session ID, so a planted cookie authenticates nothing. Unknown email, wrong password, and a deactivated account are one response with one message and the same cost — anything else enumerates accounts.',
  request: { body: { content: { 'application/json': { schema: loginRequestSchema } } } },
  responses: {
    200: json('Signed in; the session cookie is set', SessionResponse),
    401: json('Invalid email or password', ApiError),
    429: json('Throttled. `Retry-After` carries the wait in seconds.', ApiError),
    422: json('Request validation failed', ApiError),
    500: json('Unexpected error', ApiError),
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['Auth'],
  summary: 'Sign out of this session',
  request: { headers: csrfHeader },
  responses: { 204: { description: 'Session destroyed' }, ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/auth/me',
  tags: ['Auth'],
  summary: 'The current session',
  description:
    'Also how a client that reloaded recovers its CSRF token. The user is re-read from the database on every request, so a role change or deactivation takes effect on the next call rather than when the cookie expires.',
  responses: { 200: json('The current session', SessionResponse), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/auth/sessions',
  tags: ['Auth'],
  summary: "The caller's own live sessions",
  responses: { 200: json('Live sessions', SessionListResponse), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout-others',
  tags: ['Auth'],
  summary: 'Sign out everywhere except here',
  description:
    'The same revocation path deactivation (4.3) and password reset (4.6) use. Sessions are deletable by user ID, which is what makes deactivation more than a label.',
  request: { headers: csrfHeader },
  responses: {
    200: json('How many sessions were revoked', z.object({ revoked: z.number().int() })),
    ...errorResponses,
  },
});

// --- Tickets ---------------------------------------------------------------

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
// The acting user is the session's user. Every one of these requires both the
// session cookie and the CSRF token that came with it.

registry.registerPath({
  method: 'post',
  path: '/tickets/{number}/reply',
  tags: ['Tickets'],
  summary: 'Reply to a ticket',
  description:
    'Persists an outbound message and hands the conversation back: `waitingOn` becomes CUSTOMER and the ticket drops out of the default queue without anyone resolving it. Replying to a RESOLVED ticket reopens it. Sending the mail itself arrives at task 6.9.',
  request: {
    params: numberParam,
    headers: csrfHeader,
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
  request: { params: numberParam, headers: csrfHeader },
  responses: { 200: json('The resolved ticket', TicketDetail), ...writeResponses },
});

registry.registerPath({
  method: 'post',
  path: '/tickets/{number}/close',
  tags: ['Tickets'],
  summary: 'Close a ticket',
  description:
    'Terminal, and only ever reached by a person — nothing closes a ticket on a timer. A later customer reply opens a new cross-linked ticket rather than reopening this one.',
  request: {
    params: numberParam,
    headers: csrfHeader,
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
  request: { params: numberParam, headers: csrfHeader },
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
    headers: csrfHeader,
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
    headers: csrfHeader,
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
