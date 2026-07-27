import type { JobStatus, Prisma } from '@prisma/client';
import type {
  SummaryState,
  TicketDetail,
  TicketListQuery,
  TicketListResponse,
  TicketSummary,
} from '@support/shared';
import { ticketListQuerySchema } from '@support/shared';
import { prisma } from '../db/prisma.js';

/**
 * Read side of the ticket domain. Writes — and every status transition — go
 * through the Phase 2 transition service, never through here.
 */

/** Never selects a password hash. Explicit, rather than relying on remembering to strip it. */
const userSummarySelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
} satisfies Prisma.UserSelect;

const customerSummarySelect = {
  id: true,
  email: true,
  displayName: true,
  firstSeenAt: true,
} satisfies Prisma.CustomerSelect;

const ticketSummarySelect = {
  id: true,
  number: true,
  subject: true,
  status: true,
  waitingOn: true,
  classificationState: true,
  category: true,
  flaggedForResearch: true,
  createdAt: true,
  updatedAt: true,
  lastInboundAt: true,
  lastOutboundAt: true,
  customer: { select: customerSummarySelect },
  assignee: { select: userSummarySelect },
  _count: { select: { messages: true } },
} satisfies Prisma.TicketSelect;

type TicketSummaryRow = Prisma.TicketGetPayload<{ select: typeof ticketSummarySelect }>;

function toSummary(row: TicketSummaryRow): TicketSummary {
  return {
    id: row.id,
    number: row.number,
    subject: row.subject,
    status: row.status,
    waitingOn: row.waitingOn,
    classificationState: row.classificationState,
    category: row.category,
    flaggedForResearch: row.flaggedForResearch,
    customer: {
      id: row.customer.id,
      email: row.customer.email,
      displayName: row.customer.displayName,
      firstSeenAt: row.customer.firstSeenAt.toISOString(),
    },
    assignee: row.assignee,
    messageCount: row._count.messages,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
    lastOutboundAt: row.lastOutboundAt?.toISOString() ?? null,
  };
}

const ORDER_BY: Record<string, Prisma.TicketOrderByWithRelationInput> = {
  // The default queue is worked oldest first: the ticket that has waited
  // longest is the one at risk of breaching the first-response target.
  oldest: { createdAt: 'asc' },
  newest: { createdAt: 'desc' },
  recently_updated: { updatedAt: 'desc' },
};

export async function listTickets(rawQuery: unknown): Promise<TicketListResponse> {
  const query: TicketListQuery & { page: number; pageSize: number; sort: string } =
    ticketListQuerySchema.parse(rawQuery);

  const where: Prisma.TicketWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.waitingOn ? { waitingOn: query.waitingOn } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.classificationState ? { classificationState: query.classificationState } : {}),
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(query.unassigned ? { assigneeId: null } : {}),
    ...(query.flaggedForResearch === undefined
      ? {}
      : { flaggedForResearch: query.flaggedForResearch }),
  };

  // Pagination is server-side: the queue is expected to outgrow one page, and
  // shipping every row to the browser to slice it there does not survive the
  // first busy week.
  const [totalItems, rows] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      select: ticketSummarySelect,
      orderBy: ORDER_BY[query.sort] ?? ORDER_BY.oldest,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: rows.map(toSummary),
    pageInfo: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
    },
  };
}

/**
 * Where the summary has got to, from the newest summarize job plus whether text
 * has actually landed.
 *
 * The job's status is the source of truth while one is in flight; once it has
 * succeeded, the presence of the text is. That ordering matters for the
 * re-summarize case: a ticket that already has a summary and a newly queued job
 * reads `PENDING`, not `READY`, so the UI shows work in progress rather than
 * stale text with no indication anything is happening.
 */
function toSummaryState(latestJob: JobStatus | undefined, hasSummary: boolean): SummaryState {
  switch (latestJob) {
    case 'PENDING':
      return 'PENDING';
    case 'RUNNING':
      return 'RUNNING';
    case 'FAILED':
    case 'DEAD':
      // A retry lands back on PENDING, so anything still marked failed here has
      // exhausted its attempts. Surfaced, never blocking.
      return 'FAILED';
    default:
      return hasSummary ? 'READY' : 'NONE';
  }
}

export async function getTicketByNumber(number: number): Promise<TicketDetail | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { number },
    select: {
      ...ticketSummarySelect,
      summary: true,
      summaryGeneratedAt: true,
      jobs: {
        where: { type: 'SUMMARIZE_TICKET' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true },
      },
      aiCategory: true,
      aiCategoryConfidence: true,
      gmailThreadId: true,
      resolvedAt: true,
      closedAt: true,
      customerId: true,
      messages: {
        orderBy: { occurredAt: 'asc' },
        select: {
          id: true,
          direction: true,
          bodyText: true,
          subject: true,
          aiDrafted: true,
          aiDraftEdited: true,
          occurredAt: true,
          author: { select: userSummarySelect },
        },
      },
      previousTicket: {
        select: {
          id: true,
          number: true,
          subject: true,
          status: true,
          category: true,
          createdAt: true,
        },
      },
    },
  });

  if (!ticket) return null;

  // History spans tickets — this is the difference between a support inbox and
  // a CRM, and it matters most on a repeat refund request.
  const history = await prisma.ticket.findMany({
    where: { customerId: ticket.customerId, id: { not: ticket.id } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      number: true,
      subject: true,
      status: true,
      category: true,
      createdAt: true,
    },
  });

  return {
    ...toSummary(ticket),
    summary: ticket.summary,
    summaryGeneratedAt: ticket.summaryGeneratedAt?.toISOString() ?? null,
    summaryState: toSummaryState(ticket.jobs[0]?.status, ticket.summary !== null),
    aiCategory: ticket.aiCategory,
    aiCategoryConfidence: ticket.aiCategoryConfidence,
    gmailThreadId: ticket.gmailThreadId,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    messages: ticket.messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      bodyText: message.bodyText,
      subject: message.subject,
      author: message.author,
      aiDrafted: message.aiDrafted,
      aiDraftEdited: message.aiDraftEdited,
      occurredAt: message.occurredAt.toISOString(),
    })),
    customerHistory: history.map((related) => ({
      ...related,
      createdAt: related.createdAt.toISOString(),
    })),
    previousTicket: ticket.previousTicket
      ? { ...ticket.previousTicket, createdAt: ticket.previousTicket.createdAt.toISOString() }
      : null,
  };
}

export async function listUsers() {
  return prisma.user.findMany({ orderBy: { name: 'asc' }, select: userSummarySelect });
}
