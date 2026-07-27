import type { Ticket } from '@prisma/client';
import { prisma } from '../db/prisma.js';

/**
 * Writing an AI summary onto a ticket (task 5.9).
 *
 * This deliberately does **not** go through the transition service. That
 * service governs *status*, and every status change must pass through it — a
 * summary changes no status, so routing it there would blur what that rule
 * means. What it does share is the audit discipline: the entry is written in
 * the same transaction as the change, and the log stays append-only.
 *
 * The actor is `SYSTEM` with a null `actorId`, which is what
 * `audit_events_actor_ck` permits and requires for a change no person made.
 * Summarizing is the one thing here a machine may do unattended; it is also why
 * the audit row matters — "who wrote this text" has an answer even when the
 * answer is "nobody".
 */
export async function setTicketSummary(params: {
  ticketId: string;
  summary: string;
  now?: Date;
}): Promise<Ticket> {
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.update({
      where: { id: params.ticketId },
      data: { summary: params.summary, summaryGeneratedAt: now },
    });

    await tx.auditEvent.create({
      data: {
        actorType: 'SYSTEM',
        actorId: null,
        action: 'ticket.summarized',
        entityType: 'ticket',
        entityId: ticket.id,
        ticketId: ticket.id,
        // The text itself lives on the ticket; the audit entry records that it
        // was replaced and how much of the thread it was drawn from.
        metadata: { summaryLength: params.summary.length },
      },
    });

    return ticket;
  });
}
