import type { PrismaClient } from '@prisma/client';
import { ticketFixtures, type TicketFixture } from './ticket-fixtures.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number, now: number): Date {
  return new Date(now - days * DAY_MS);
}

/** Derives the metric timestamps from the thread rather than restating them. */
function timestampsFor(fixture: TicketFixture, now: number) {
  const inbound = fixture.messages.filter((m) => m.direction === 'INBOUND');
  const outbound = fixture.messages.filter((m) => m.direction === 'OUTBOUND');

  const oldest = Math.max(...fixture.messages.map((m) => m.daysAgo));
  const firstInbound = inbound.length ? Math.max(...inbound.map((m) => m.daysAgo)) : undefined;
  const lastInbound = inbound.length ? Math.min(...inbound.map((m) => m.daysAgo)) : undefined;
  const firstOutbound = outbound.length ? Math.max(...outbound.map((m) => m.daysAgo)) : undefined;
  const lastOutbound = outbound.length ? Math.min(...outbound.map((m) => m.daysAgo)) : undefined;

  return {
    createdAt: daysAgo(oldest, now),
    firstInboundAt: firstInbound === undefined ? null : daysAgo(firstInbound, now),
    lastInboundAt: lastInbound === undefined ? null : daysAgo(lastInbound, now),
    // First response counts only human outbound messages.
    firstResponseAt: firstOutbound === undefined ? null : daysAgo(firstOutbound, now),
    lastOutboundAt: lastOutbound === undefined ? null : daysAgo(lastOutbound, now),
    resolvedAt:
      fixture.resolvedDaysAgo === undefined ? null : daysAgo(fixture.resolvedDaysAgo, now),
    closedAt: fixture.closedDaysAgo === undefined ? null : daysAgo(fixture.closedDaysAgo, now),
  };
}

function requireAgentId(agentIds: Map<string, string>, email: string): string {
  const id = agentIds.get(email);
  if (!id) {
    throw new Error(
      `Fixture references unseeded agent ${email}. Add them to AGENTS in seeds/users.ts.`,
    );
  }
  return id;
}

async function upsertCustomers(prisma: PrismaClient, now: number): Promise<Map<string, string>> {
  const byEmail = new Map<string, TicketFixture[]>();
  for (const fixture of ticketFixtures) {
    const list = byEmail.get(fixture.customerEmail) ?? [];
    list.push(fixture);
    byEmail.set(fixture.customerEmail, list);
  }

  const ids = new Map<string, string>();
  for (const [email, fixtures] of byEmail) {
    const oldest = Math.max(...fixtures.flatMap((f) => f.messages.map((m) => m.daysAgo)));
    const displayName = fixtures[0]?.customerName ?? email;

    const customer = await prisma.customer.upsert({
      where: { email },
      create: { email, displayName, firstSeenAt: daysAgo(oldest, now) },
      update: { displayName },
      select: { id: true },
    });
    ids.set(email, customer.id);
  }

  return ids;
}

/**
 * Idempotent: fixtures carry stable IDs, so re-running the seed refreshes the
 * corpus in place instead of piling up duplicates.
 */
export async function seedTickets(prisma: PrismaClient): Promise<void> {
  const now = Date.now();

  const customerIds = await upsertCustomers(prisma, now);

  const agents = await prisma.user.findMany({ select: { id: true, email: true } });
  const agentIds = new Map(agents.map((a) => [a.email, a.id]));

  // Two passes: every ticket is written before any cross-link is set, so a
  // continuation can point at a ticket that appears later in the list.
  for (const fixture of ticketFixtures) {
    const customerId = customerIds.get(fixture.customerEmail);
    if (!customerId) throw new Error(`No customer seeded for ${fixture.customerEmail}`);

    const assigneeId = fixture.assigneeEmail
      ? requireAgentId(agentIds, fixture.assigneeEmail)
      : undefined;

    const times = timestampsFor(fixture, now);
    const correctorId = fixture.categoryCorrectedFrom ? (assigneeId ?? null) : null;

    const data = {
      customerId,
      subject: fixture.subject,
      status: fixture.status,
      waitingOn: fixture.waitingOn,
      classificationState: fixture.classificationState,
      category: fixture.category ?? null,
      aiCategory: fixture.aiCategory ?? null,
      aiCategoryConfidence: fixture.aiCategoryConfidence ?? null,
      categoryCorrectedById: correctorId,
      categoryCorrectedAt: fixture.categoryCorrectedFrom ? times.lastOutboundAt : null,
      assigneeId: assigneeId ?? null,
      flaggedForResearch: fixture.flaggedForResearch ?? false,
      summary: fixture.summary ?? null,
      gmailThreadId: fixture.gmailThreadId ?? null,
      ...times,
    };

    await prisma.ticket.upsert({
      where: { id: fixture.id },
      create: { id: fixture.id, ...data },
      update: data,
    });

    // Replace the thread wholesale so edited fixture bodies actually take.
    await prisma.message.deleteMany({ where: { ticketId: fixture.id } });
    await prisma.message.createMany({
      data: fixture.messages.map((message, index) => ({
        ticketId: fixture.id,
        direction: message.direction,
        // Never fall back to null: an outbound message with no author is
        // exactly the state the schema and the PRD forbid, and silently
        // writing one would make the thread view and the adoption query wrong
        // with nothing to point at.
        authorId: message.authorEmail ? requireAgentId(agentIds, message.authorEmail) : null,
        subject: index === 0 ? fixture.subject : `Re: ${fixture.subject}`,
        bodyText: message.bodyText,
        aiDrafted: message.aiDrafted ?? false,
        aiDraftEdited: message.aiDrafted ? (message.aiDraftEdited ?? false) : null,
        gmailThreadId: fixture.gmailThreadId ?? null,
        occurredAt: daysAgo(message.daysAgo, now),
      })),
    });
  }

  for (const fixture of ticketFixtures) {
    if (!fixture.previousTicketId) continue;
    await prisma.ticket.update({
      where: { id: fixture.id },
      data: { previousTicketId: fixture.previousTicketId },
    });
  }

  const messageCount = ticketFixtures.reduce((total, f) => total + f.messages.length, 0);
  console.log(
    `  seeded ${ticketFixtures.length} tickets, ${messageCount} messages, ${customerIds.size} customers`,
  );
}
