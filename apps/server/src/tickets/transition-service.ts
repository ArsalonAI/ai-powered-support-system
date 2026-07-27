import type { Prisma, Ticket, TicketCategory, TicketStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../http/api-error.js';

/**
 * The write side of the ticket domain. **Every** status change goes through
 * here — a raw `prisma.ticket.update({ data: { status } })` anywhere else is a
 * defect, because it skips both the legality check and the audit entry.
 *
 * Two rules from the PRD are encoded structurally rather than by convention:
 *
 * - `CLOSED` is terminal. It has no outgoing transitions, so a reply to a
 *   closed ticket opens a *new* cross-linked ticket instead of reopening it.
 * - Every transition writes an audit event, in the same transaction as the
 *   change. The audit log is append-only; nothing here updates or deletes one.
 */

/**
 * Who is acting. `SYSTEM` is for the paths with no person behind them — email
 * ingest (Phase 6) is the remaining one, now that the timed sweeps are gone.
 * The database CHECK constraint pairs this with `actorId`, so a user action
 * without an id (or a system action carrying one) is rejected by Postgres, not
 * just by us.
 */
export type Actor = { type: 'USER'; userId: string } | { type: 'SYSTEM' };

/** Tickets are addressed by their human-facing number in the UI and by id internally. */
export type TicketRef = { id: string } | { number: number };

/**
 * The state machine, declared rather than scattered across if-statements, so
 * task 2.16 can assert every cell — including the empty row that makes `CLOSED`
 * terminal.
 */
export const LEGAL_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  OPEN: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'CLOSED'],
  CLOSED: [],
};

export function isLegalTransition(from: TicketStatus, to: TicketStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

function assertLegalTransition(from: TicketStatus, to: TicketStatus): void {
  if (!isLegalTransition(from, to)) {
    const detail =
      from === 'CLOSED'
        ? 'CLOSED is terminal — a reply to a closed ticket opens a new cross-linked ticket.'
        : `Legal transitions from ${from}: ${LEGAL_TRANSITIONS[from].join(', ') || 'none'}.`;
    throw new ApiError(
      'ILLEGAL_TRANSITION',
      `Cannot move a ticket from ${from} to ${to}. ${detail}`,
    );
  }
}

/** Terminal means no new activity of any kind, not just no status change. */
function assertNotClosed(ticket: Ticket, action: string): void {
  if (ticket.status === 'CLOSED') {
    throw new ApiError(
      'ILLEGAL_TRANSITION',
      `Cannot ${action} on ticket ${ticket.number}: it is closed, and closed is terminal.`,
    );
  }
}

async function findTicket(tx: Prisma.TransactionClient, ref: TicketRef): Promise<Ticket> {
  // Resolved inside the transaction rather than by the caller, so the status
  // that gets checked is the status that gets written against.
  const ticket = await tx.ticket.findUnique({ where: ref as Prisma.TicketWhereUniqueInput });
  if (!ticket) {
    throw ApiError.notFound(
      'number' in ref ? `No ticket with number ${ref.number}` : `No ticket with id ${ref.id}`,
    );
  }
  return ticket;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  params: {
    actor: Actor;
    action: string;
    ticketId: string;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorType: params.actor.type,
      actorId: params.actor.type === 'USER' ? params.actor.userId : null,
      action: params.action,
      entityType: 'ticket',
      entityId: params.ticketId,
      ticketId: params.ticketId,
      metadata: params.metadata ?? {},
    },
  });
}

// ---------------------------------------------------------------------------
// Status transitions (2.3, 2.4, 2.5)
// ---------------------------------------------------------------------------

export async function resolveTicket(params: {
  ref: TicketRef;
  actor: Actor;
  now?: Date;
}): Promise<Ticket> {
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const ticket = await findTicket(tx, params.ref);
    assertLegalTransition(ticket.status, 'RESOLVED');

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: { status: 'RESOLVED', resolvedAt: now },
    });

    await writeAudit(tx, {
      actor: params.actor,
      action: 'ticket.resolved',
      ticketId: ticket.id,
      metadata: { from: ticket.status, to: 'RESOLVED' },
    });

    return updated;
  });
}

export async function closeTicket(params: {
  ref: TicketRef;
  actor: Actor;
  reason?: string;
  now?: Date;
}): Promise<Ticket> {
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const ticket = await findTicket(tx, params.ref);
    assertLegalTransition(ticket.status, 'CLOSED');

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: { status: 'CLOSED', closedAt: now },
    });

    await writeAudit(tx, {
      actor: params.actor,
      action: 'ticket.closed',
      ticketId: ticket.id,
      metadata: {
        from: ticket.status,
        to: 'CLOSED',
        ...(params.reason ? { reason: params.reason } : {}),
      },
    });

    return updated;
  });
}

export async function reopenTicket(params: { ref: TicketRef; actor: Actor }): Promise<Ticket> {
  return prisma.$transaction(async (tx) => {
    const ticket = await findTicket(tx, params.ref);
    assertLegalTransition(ticket.status, 'OPEN');

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        status: 'OPEN',
        // A reopened ticket needs a human again, and its resolution never happened.
        waitingOn: 'US',
        resolvedAt: null,
        reopenCount: { increment: 1 },
      },
    });

    await writeAudit(tx, {
      actor: params.actor,
      action: 'ticket.reopened',
      ticketId: ticket.id,
      metadata: { from: ticket.status, to: 'OPEN' },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Messages (2.6)
// ---------------------------------------------------------------------------

/**
 * The AI adoption flags are the primary success metric and cannot be
 * reconstructed later, so the pairing is checked here as well as by the
 * `messages_ai_flags_ck` CHECK constraint. Catching it in the app layer turns a
 * 500 from Postgres into a 422 naming the field.
 */
export function assertAiFlagsCoherent(aiDrafted: boolean, aiDraftEdited: boolean | null): void {
  if (aiDrafted && aiDraftEdited === null) {
    throw new ApiError('VALIDATION_FAILED', 'aiDraftEdited is required when aiDrafted is true', {
      issues: [{ path: 'aiDraftEdited', message: 'Required when aiDrafted is true' }],
    });
  }
  if (!aiDrafted && aiDraftEdited !== null) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'aiDraftEdited is meaningless when aiDrafted is false',
      {
        issues: [{ path: 'aiDraftEdited', message: 'Must be omitted when aiDrafted is false' }],
      },
    );
  }
}

/**
 * An agent's reply. Persisted only — Gmail send arrives at 6.9.
 *
 * Replying to a `RESOLVED` ticket reopens it in the same transaction: the
 * conversation demonstrably is not finished. Replying to a `CLOSED` one is
 * rejected.
 */
export async function appendOutboundMessage(params: {
  ref: TicketRef;
  actor: Extract<Actor, { type: 'USER' }>;
  bodyText: string;
  subject?: string | null;
  aiDrafted: boolean;
  aiDraftEdited?: boolean | null;
  now?: Date;
}): Promise<{ ticket: Ticket; messageId: string }> {
  const now = params.now ?? new Date();
  const aiDraftEdited = params.aiDraftEdited ?? null;
  assertAiFlagsCoherent(params.aiDrafted, aiDraftEdited);

  return prisma.$transaction(async (tx) => {
    const ticket = await findTicket(tx, params.ref);
    assertNotClosed(ticket, 'reply');

    if (ticket.status === 'RESOLVED') {
      assertLegalTransition(ticket.status, 'OPEN');
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: 'OPEN', resolvedAt: null, reopenCount: { increment: 1 } },
      });
      await writeAudit(tx, {
        actor: params.actor,
        action: 'ticket.reopened',
        ticketId: ticket.id,
        metadata: { from: 'RESOLVED', to: 'OPEN', cause: 'agent_reply' },
      });
    }

    const message = await tx.message.create({
      data: {
        ticketId: ticket.id,
        direction: 'OUTBOUND',
        // The CHECK constraint requires this; the seam guarantees it is real.
        authorId: params.actor.userId,
        subject: params.subject ?? null,
        bodyText: params.bodyText,
        aiDrafted: params.aiDrafted,
        aiDraftEdited,
        occurredAt: now,
      },
      select: { id: true },
    });

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        // Sending hands the conversation back and drops the ticket out of the
        // default queue without anyone resolving it.
        waitingOn: 'CUSTOMER',
        lastOutboundAt: now,
        // First response counts only human outbound messages, and only the first.
        ...(ticket.firstResponseAt === null ? { firstResponseAt: now } : {}),
      },
    });

    await writeAudit(tx, {
      actor: params.actor,
      action: 'ticket.replied',
      ticketId: ticket.id,
      metadata: { messageId: message.id, aiDrafted: params.aiDrafted, aiDraftEdited },
    });

    return { ticket: updated, messageId: message.id };
  });
}

/**
 * A customer reply landing on an existing ticket. Wired to Gmail at 6.6; it
 * lives here because the closed-ticket cross-link is a lifecycle rule, not an
 * email one, and 2.16 tests it without any mail involved.
 *
 * Returns the ticket the message landed on — which is a *different* ticket from
 * the one passed in when that one was closed.
 */
export async function recordCustomerReply(params: {
  ref: TicketRef;
  bodyText: string;
  subject?: string | null;
  gmailMessageId?: string | null;
  now?: Date;
}): Promise<{ ticket: Ticket; createdNewTicket: boolean }> {
  const now = params.now ?? new Date();
  const actor: Actor = { type: 'SYSTEM' };

  return prisma.$transaction(async (tx) => {
    const ticket = await findTicket(tx, params.ref);

    // Closed is terminal: the reply opens a new ticket cross-linked to the old
    // one, so the history stays traversable rather than being reopened.
    if (ticket.status === 'CLOSED') {
      const continuation = await tx.ticket.create({
        data: {
          customerId: ticket.customerId,
          subject: ticket.subject,
          status: 'OPEN',
          waitingOn: 'US',
          classificationState: 'PENDING',
          gmailThreadId: ticket.gmailThreadId,
          previousTicketId: ticket.id,
          firstInboundAt: now,
          lastInboundAt: now,
        },
      });

      await tx.message.create({
        data: {
          ticketId: continuation.id,
          direction: 'INBOUND',
          bodyText: params.bodyText,
          subject: params.subject ?? null,
          gmailMessageId: params.gmailMessageId ?? null,
          gmailThreadId: ticket.gmailThreadId,
          aiDrafted: false,
          occurredAt: now,
        },
      });

      await writeAudit(tx, {
        actor,
        action: 'ticket.continued',
        ticketId: continuation.id,
        metadata: { previousTicketId: ticket.id, previousTicketNumber: ticket.number },
      });

      return { ticket: continuation, createdNewTicket: true };
    }

    if (ticket.status === 'RESOLVED') {
      assertLegalTransition(ticket.status, 'OPEN');
      await writeAudit(tx, {
        actor,
        action: 'ticket.reopened',
        ticketId: ticket.id,
        metadata: { from: 'RESOLVED', to: 'OPEN', cause: 'customer_reply' },
      });
    }

    await tx.message.create({
      data: {
        ticketId: ticket.id,
        direction: 'INBOUND',
        bodyText: params.bodyText,
        subject: params.subject ?? null,
        gmailMessageId: params.gmailMessageId ?? null,
        gmailThreadId: ticket.gmailThreadId,
        aiDrafted: false,
        occurredAt: now,
      },
    });

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        status: 'OPEN',
        waitingOn: 'US',
        ...(ticket.status === 'RESOLVED'
          ? { resolvedAt: null, reopenCount: { increment: 1 } }
          : {}),
        lastInboundAt: now,
        ...(ticket.firstInboundAt === null ? { firstInboundAt: now } : {}),
      },
    });

    return { ticket: updated, createdNewTicket: false };
  });
}

// ---------------------------------------------------------------------------
// Assignment (2.7) and category (2.8)
// ---------------------------------------------------------------------------

/**
 * Claiming signals "I'm on this" and never restricts anyone else — any agent
 * can still act on any ticket. Audited because "who picked this up" is part of
 * the ticket's history.
 */
export async function setAssignee(params: {
  ref: TicketRef;
  actor: Extract<Actor, { type: 'USER' }>;
  assigneeId: string | null;
}): Promise<Ticket> {
  return prisma.$transaction(async (tx) => {
    const ticket = await findTicket(tx, params.ref);
    assertNotClosed(ticket, 'change the assignee');

    if (params.assigneeId !== null) {
      const assignee = await tx.user.findFirst({
        where: { id: params.assigneeId, isActive: true },
        select: { id: true },
      });
      if (!assignee) {
        throw ApiError.badRequest(`No active user with id ${params.assigneeId}`);
      }
    }

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: { assigneeId: params.assigneeId },
    });

    await writeAudit(tx, {
      actor: params.actor,
      action: params.assigneeId === null ? 'ticket.unclaimed' : 'ticket.claimed',
      ticketId: ticket.id,
      metadata: { from: ticket.assigneeId, to: params.assigneeId },
    });

    return updated;
  });
}

/**
 * A manual category set or override.
 *
 * `aiCategory` is deliberately left alone: the gap between what the classifier
 * said and what an agent chose *is* the labeled eval data task 5.10 collects
 * and 5.18 measures against. Overwriting it would destroy the signal.
 */
export async function setTicketCategory(params: {
  ref: TicketRef;
  actor: Extract<Actor, { type: 'USER' }>;
  category: TicketCategory;
  now?: Date;
}): Promise<Ticket> {
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const ticket = await findTicket(tx, params.ref);
    assertNotClosed(ticket, 'change the category');

    const isCorrection = ticket.aiCategory !== null && ticket.aiCategory !== params.category;

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        category: params.category,
        // An agent choosing a category is itself a classification, so a ticket
        // whose classifier failed stops showing the manual-triage badge.
        classificationState: 'DONE',
        ...(isCorrection
          ? { categoryCorrectedAt: now, categoryCorrectedById: params.actor.userId }
          : {}),
      },
    });

    await writeAudit(tx, {
      actor: params.actor,
      action: isCorrection ? 'ticket.category_corrected' : 'ticket.category_set',
      ticketId: ticket.id,
      metadata: {
        from: ticket.category,
        to: params.category,
        aiCategory: ticket.aiCategory,
      },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Timed sweeps — removed
// ---------------------------------------------------------------------------
//
// There were two, from the original task 2.9: a 7-day auto-resolve and a 14-day
// auto-close. Both are gone, deliberately, and the specs were amended rather
// than left describing them.
//
// **No ticket changes status without a person deciding it should.** A queue
// that tidies itself reports a backlog smaller than the one that exists, and
// the ticket it tidied away is exactly the one nobody got to. The `SYSTEM`
// actor still exists on `Actor` because email ingest (Phase 6) legitimately
// acts without a user; nothing in the ticket lifecycle uses it now.
//
// The consequence to keep in view: `RESOLVED` and `CLOSED` are now only ever
// reached by hand, so nothing bounds how long a ticket sits in either. `CLOSED`
// remains terminal and reachable only through `closeTicket`.
