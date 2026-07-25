import { z } from 'zod';

/**
 * Wire contract for the ticket read endpoints.
 *
 * These schemas are the single source of truth three times over: the server
 * validates against them, the OpenAPI document is generated from them, and the
 * client infers its types from them. A field renamed here fails the typecheck
 * on both sides rather than drifting quietly.
 */

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const ticketSortSchema = z.enum(['oldest', 'newest', 'recently_updated']);
export type TicketSort = z.infer<typeof ticketSortSchema>;

/**
 * Filters for the ticket list. Every field is optional; the *caller* decides
 * the default view rather than the endpoint hard-coding it, because Phase 3's
 * saved views need the same endpoint to serve other filter combinations.
 */
export const ticketListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['OPEN', 'RESOLVED', 'CLOSED']).optional(),
  waitingOn: z.enum(['US', 'CUSTOMER']).optional(),
  category: z.enum(['TECHNICAL_QUESTION', 'REFUND_REQUEST', 'GENERAL_QUESTION']).optional(),
  classificationState: z.enum(['PENDING', 'DONE', 'FAILED']).optional(),
  assigneeId: z.string().uuid().optional(),
  unassigned: z.coerce.boolean().optional(),
  flaggedForResearch: z.coerce.boolean().optional(),
  sort: ticketSortSchema.default('oldest'),
});
export type TicketListQuery = z.input<typeof ticketListQuerySchema>;

export const customerSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  firstSeenAt: z.string().datetime(),
});

export const userSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['AGENT', 'ADMIN']),
  isActive: z.boolean(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const ticketSummarySchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  subject: z.string(),
  status: z.enum(['OPEN', 'RESOLVED', 'CLOSED']),
  waitingOn: z.enum(['US', 'CUSTOMER']),
  classificationState: z.enum(['PENDING', 'DONE', 'FAILED']),
  category: z.enum(['TECHNICAL_QUESTION', 'REFUND_REQUEST', 'GENERAL_QUESTION']).nullable(),
  flaggedForResearch: z.boolean(),
  customer: customerSummarySchema,
  assignee: userSummarySchema.nullable(),
  messageCount: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastInboundAt: z.string().datetime().nullable(),
  lastOutboundAt: z.string().datetime().nullable(),
});
export type TicketSummary = z.infer<typeof ticketSummarySchema>;

export const messageSchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  bodyText: z.string(),
  subject: z.string().nullable(),
  /** Null for inbound. Every outbound message has a named human author. */
  author: userSummarySchema.nullable(),
  aiDrafted: z.boolean(),
  aiDraftEdited: z.boolean().nullable(),
  occurredAt: z.string().datetime(),
});
export type Message = z.infer<typeof messageSchema>;

/** A prior ticket from the same customer — the cross-ticket history that makes this a CRM. */
export const relatedTicketSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  subject: z.string(),
  status: z.enum(['OPEN', 'RESOLVED', 'CLOSED']),
  category: z.enum(['TECHNICAL_QUESTION', 'REFUND_REQUEST', 'GENERAL_QUESTION']).nullable(),
  createdAt: z.string().datetime(),
});

export const ticketDetailSchema = ticketSummarySchema.extend({
  summary: z.string().nullable(),
  aiCategory: z.enum(['TECHNICAL_QUESTION', 'REFUND_REQUEST', 'GENERAL_QUESTION']).nullable(),
  aiCategoryConfidence: z.number().nullable(),
  gmailThreadId: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  messages: z.array(messageSchema),
  /** Other tickets from the same email address, newest first. */
  customerHistory: z.array(relatedTicketSchema),
  /** Set when this ticket continues a closed one. */
  previousTicket: relatedTicketSchema.nullable(),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const pageInfoSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
});

export const ticketListResponseSchema = z.object({
  items: z.array(ticketSummarySchema),
  pageInfo: pageInfoSchema,
});
export type TicketListResponse = z.infer<typeof ticketListResponseSchema>;

export const userListResponseSchema = z.object({
  items: z.array(userSummarySchema),
});

/**
 * The AI adoption figures. Derived entirely from the per-message flags, which
 * is why those flags ship with the first draft rather than later.
 */
export const adoptionStatsSchema = z.object({
  sentReplies: z.number().int(),
  startedAsAiDraft: z.number().int(),
  editedBeforeSend: z.number().int(),
  /** Share of sent replies that began as an AI draft. Null when nothing has been sent. */
  acceptanceRate: z.number().nullable(),
  /** Share of accepted drafts materially edited before sending. */
  editRate: z.number().nullable(),
  /** Tickets where the grounding gate withheld a draft — a KB coverage measure. */
  ticketsFlaggedForResearch: z.number().int(),
});
export type AdoptionStats = z.infer<typeof adoptionStatsSchema>;

export const queueStatsSchema = z.object({
  byStatus: z.record(z.string(), z.number().int()),
  byCategory: z.record(z.string(), z.number().int()),
  /** The default view's depth: OPEN and waiting on us. */
  needsReply: z.number().int(),
  unclassified: z.number().int(),
});

export const statsResponseSchema = z.object({
  tickets: z.number().int(),
  customers: z.number().int(),
  queue: queueStatsSchema,
  adoption: adoptionStatsSchema,
});
export type StatsResponse = z.infer<typeof statsResponseSchema>;
