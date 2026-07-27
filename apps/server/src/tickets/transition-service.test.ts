import type { TicketStatus } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedAgents } from '../../prisma/seeds/users.js';
import { disconnectPrisma, prisma } from '../db/prisma.js';
import { sweepLoginAttempts } from '../auth/login-rate-limit.js';
import {
  appendOutboundMessage,
  closeTicket,
  isLegalTransition,
  LEGAL_TRANSITIONS,
  recordCustomerReply,
  reopenTicket,
  resolveTicket,
  setAssignee,
  setTicketCategory,
  type Actor,
} from './transition-service.js';

/**
 * The lifecycle has reopen paths, a terminal state, and cross-linking — logic
 * that stays correct only if the *illegal* transitions are asserted against,
 * not just the legal ones.
 *
 * These tests run against real Postgres deliberately. Several of the rules they
 * cover are enforced by CHECK constraints in the migration, so a mock would
 * happily accept rows the database rejects.
 */

const STATUSES: TicketStatus[] = ['OPEN', 'RESOLVED', 'CLOSED'];

let agent: { id: string };
let secondAgent: { id: string };
let customerId: string;

const actor = (): Extract<Actor, { type: 'USER' }> => ({ type: 'USER', userId: agent.id });

let ticketSeq = 0;

async function makeTicket(
  overrides: {
    status?: TicketStatus;
    waitingOn?: 'US' | 'CUSTOMER';
    lastOutboundAt?: Date | null;
    resolvedAt?: Date | null;
    aiCategory?: 'TECHNICAL_QUESTION' | 'REFUND_REQUEST' | 'GENERAL_QUESTION' | null;
    gmailThreadId?: string | null;
    firstResponseAt?: Date | null;
  } = {},
) {
  ticketSeq += 1;
  return prisma.ticket.create({
    data: {
      customerId,
      subject: `Fixture ticket ${ticketSeq}`,
      status: overrides.status ?? 'OPEN',
      waitingOn: overrides.waitingOn ?? 'US',
      lastOutboundAt: overrides.lastOutboundAt ?? null,
      resolvedAt: overrides.resolvedAt ?? null,
      aiCategory: overrides.aiCategory ?? null,
      gmailThreadId: overrides.gmailThreadId ?? null,
      firstResponseAt: overrides.firstResponseAt ?? null,
    },
  });
}

async function auditFor(ticketId: string) {
  return prisma.auditEvent.findMany({
    where: { ticketId },
    orderBy: { createdAt: 'asc' },
    select: { action: true, actorType: true, actorId: true, metadata: true },
  });
}

beforeAll(async () => {
  // Agents outlive the per-test truncation below — they are never deleted,
  // which is the same reason the real system deactivates rather than deletes.
  await seedAgents(prisma);
  const agents = await prisma.user.findMany({ orderBy: { name: 'asc' }, select: { id: true } });
  if (agents.length < 2) throw new Error('Expected at least two seeded agents');
  agent = agents[0]!;
  secondAgent = agents[1]!;
}, 60_000);

/** Order matters: audit actors and message authors are ON DELETE RESTRICT. */
async function truncateTicketData() {
  await prisma.auditEvent.deleteMany();
  await prisma.message.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.customer.deleteMany();
}

beforeEach(async () => {
  await truncateTicketData();

  const customer = await prisma.customer.create({
    data: {
      email: `customer-${Date.now()}-${ticketSeq}@example.com`,
      displayName: 'Test Customer',
    },
  });
  customerId = customer.id;
});

afterAll(async () => {
  // Leave the database as we found it. Files share one database and run in
  // sequence, so rows surviving the last test become another file's phantom
  // ticket — which shows up as an off-by-one in a queue count, nowhere near
  // the file that caused it.
  await truncateTicketData();
  await disconnectPrisma();
});

// ---------------------------------------------------------------------------

describe('the transition table', () => {
  it('makes CLOSED terminal — it has no outgoing transitions at all', () => {
    expect(LEGAL_TRANSITIONS.CLOSED).toEqual([]);
  });

  // The whole 3x3 grid, so a transition added to the table without thought
  // fails here rather than shipping.
  const EXPECTED_LEGAL = new Set([
    'OPEN>RESOLVED',
    'OPEN>CLOSED',
    'RESOLVED>OPEN',
    'RESOLVED>CLOSED',
  ]);

  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const legal = EXPECTED_LEGAL.has(`${from}>${to}`);
      it(`${legal ? 'allows' : 'rejects'} ${from} → ${to}`, () => {
        expect(isLegalTransition(from, to)).toBe(legal);
      });
    }
  }
});

describe('resolve', () => {
  it('moves an open ticket to resolved and stamps resolvedAt', async () => {
    const ticket = await makeTicket();
    const now = new Date('2026-03-01T12:00:00Z');

    const resolved = await resolveTicket({ ref: { id: ticket.id }, actor: actor(), now });

    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolvedAt).toEqual(now);
  });

  it('writes an audit event naming the acting user', async () => {
    const ticket = await makeTicket();
    await resolveTicket({ ref: { id: ticket.id }, actor: actor() });

    const audit = await auditFor(ticket.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'ticket.resolved',
      actorType: 'USER',
      actorId: agent.id,
    });
  });

  it('refuses to resolve a closed ticket', async () => {
    const ticket = await makeTicket({ status: 'CLOSED' });

    await expect(resolveTicket({ ref: { id: ticket.id }, actor: actor() })).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
      status: 409,
    });
  });

  it('leaves no audit event behind when it refuses', async () => {
    const ticket = await makeTicket({ status: 'CLOSED' });
    await expect(resolveTicket({ ref: { id: ticket.id }, actor: actor() })).rejects.toThrow();

    expect(await auditFor(ticket.id)).toHaveLength(0);
  });
});

describe('close', () => {
  it.each(['OPEN', 'RESOLVED'] as const)('closes a %s ticket', async (status) => {
    const ticket = await makeTicket({ status });
    const closed = await closeTicket({ ref: { id: ticket.id }, actor: actor() });

    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).not.toBeNull();
  });

  it('refuses to close an already-closed ticket', async () => {
    const ticket = await makeTicket({ status: 'CLOSED' });
    await expect(closeTicket({ ref: { id: ticket.id }, actor: actor() })).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
    });
  });
});

describe('reopen', () => {
  it('returns a resolved ticket to open, waiting on us, and counts the reopen', async () => {
    const ticket = await makeTicket({
      status: 'RESOLVED',
      resolvedAt: new Date(),
      waitingOn: 'CUSTOMER',
    });

    const reopened = await reopenTicket({ ref: { id: ticket.id }, actor: actor() });

    expect(reopened.status).toBe('OPEN');
    expect(reopened.waitingOn).toBe('US');
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.reopenCount).toBe(1);
  });

  it('refuses to reopen a closed ticket — that path creates a new ticket instead', async () => {
    const ticket = await makeTicket({ status: 'CLOSED' });
    await expect(reopenTicket({ ref: { id: ticket.id }, actor: actor() })).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
    });
  });

  it('refuses to reopen an already-open ticket', async () => {
    const ticket = await makeTicket({ status: 'OPEN' });
    await expect(reopenTicket({ ref: { id: ticket.id }, actor: actor() })).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
    });
  });
});

describe('replying', () => {
  it('hands the ticket back to the customer and records the first response', async () => {
    const ticket = await makeTicket();
    const now = new Date('2026-03-02T09:00:00Z');

    const { ticket: updated } = await appendOutboundMessage({
      ref: { id: ticket.id },
      actor: actor(),
      bodyText: 'Thanks for getting in touch.',
      aiDrafted: false,
      now,
    });

    expect(updated.waitingOn).toBe('CUSTOMER');
    expect(updated.status).toBe('OPEN');
    expect(updated.lastOutboundAt).toEqual(now);
    expect(updated.firstResponseAt).toEqual(now);
  });

  it('does not overwrite firstResponseAt on a second reply', async () => {
    const first = new Date('2026-03-02T09:00:00Z');
    const ticket = await makeTicket({ firstResponseAt: first });

    const { ticket: updated } = await appendOutboundMessage({
      ref: { id: ticket.id },
      actor: actor(),
      bodyText: 'Following up.',
      aiDrafted: false,
      now: new Date('2026-03-05T09:00:00Z'),
    });

    expect(updated.firstResponseAt).toEqual(first);
  });

  it('attributes the message to the acting user, which the CHECK constraint requires', async () => {
    const ticket = await makeTicket();
    const { messageId } = await appendOutboundMessage({
      ref: { id: ticket.id },
      actor: actor(),
      bodyText: 'On it.',
      aiDrafted: false,
    });

    const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(message.authorId).toBe(agent.id);
    expect(message.direction).toBe('OUTBOUND');
  });

  it('reopens a resolved ticket, because a reply means it was not finished', async () => {
    const ticket = await makeTicket({ status: 'RESOLVED', resolvedAt: new Date() });

    const { ticket: updated } = await appendOutboundMessage({
      ref: { id: ticket.id },
      actor: actor(),
      bodyText: 'One more thing.',
      aiDrafted: false,
    });

    expect(updated.status).toBe('OPEN');
    expect(updated.reopenCount).toBe(1);

    const actions = (await auditFor(ticket.id)).map((event) => event.action);
    expect(actions).toEqual(['ticket.reopened', 'ticket.replied']);
  });

  it('refuses to reply to a closed ticket', async () => {
    const ticket = await makeTicket({ status: 'CLOSED' });

    await expect(
      appendOutboundMessage({
        ref: { id: ticket.id },
        actor: actor(),
        bodyText: 'Hello?',
        aiDrafted: false,
      }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });

    expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  // The adoption flags are the primary success metric and cannot be
  // reconstructed later, so an incoherent pair must not reach the database.
  it('rejects aiDrafted without aiDraftEdited', async () => {
    const ticket = await makeTicket();
    await expect(
      appendOutboundMessage({
        ref: { id: ticket.id },
        actor: actor(),
        bodyText: 'Draft used verbatim.',
        aiDrafted: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects aiDraftEdited on a message that was not AI-drafted', async () => {
    const ticket = await makeTicket();
    await expect(
      appendOutboundMessage({
        ref: { id: ticket.id },
        actor: actor(),
        bodyText: 'Typed by hand.',
        aiDrafted: false,
        aiDraftEdited: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('records an accepted-and-edited draft', async () => {
    const ticket = await makeTicket();
    const { messageId } = await appendOutboundMessage({
      ref: { id: ticket.id },
      actor: actor(),
      bodyText: 'Draft, tweaked.',
      aiDrafted: true,
      aiDraftEdited: true,
    });

    const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(message.aiDrafted).toBe(true);
    expect(message.aiDraftEdited).toBe(true);
  });
});

describe('a customer reply', () => {
  it('sets waiting_on back to us on an open ticket', async () => {
    const ticket = await makeTicket({ waitingOn: 'CUSTOMER' });

    const { ticket: updated, createdNewTicket } = await recordCustomerReply({
      ref: { id: ticket.id },
      bodyText: 'Still broken.',
    });

    expect(createdNewTicket).toBe(false);
    expect(updated.waitingOn).toBe('US');
    expect(updated.status).toBe('OPEN');
  });

  it('reopens a resolved ticket', async () => {
    const ticket = await makeTicket({ status: 'RESOLVED', resolvedAt: new Date() });

    const { ticket: updated } = await recordCustomerReply({
      ref: { id: ticket.id },
      bodyText: 'Actually, one more thing.',
    });

    expect(updated.status).toBe('OPEN');
    expect(updated.waitingOn).toBe('US');
    expect(updated.resolvedAt).toBeNull();
    expect(updated.reopenCount).toBe(1);
  });

  // The rule that makes CLOSED genuinely terminal.
  it('opens a NEW cross-linked ticket when the original is closed', async () => {
    const original = await makeTicket({ status: 'CLOSED', gmailThreadId: 'thread-abc' });

    const { ticket: continuation, createdNewTicket } = await recordCustomerReply({
      ref: { id: original.id },
      bodyText: 'Reopening this months later.',
    });

    expect(createdNewTicket).toBe(true);
    expect(continuation.id).not.toBe(original.id);
    expect(continuation.status).toBe('OPEN');
    expect(continuation.waitingOn).toBe('US');
    expect(continuation.previousTicketId).toBe(original.id);
    // Same Gmail thread, which is exactly why gmailThreadId is not unique.
    expect(continuation.gmailThreadId).toBe('thread-abc');

    const untouched = await prisma.ticket.findUniqueOrThrow({ where: { id: original.id } });
    expect(untouched.status).toBe('CLOSED');
  });

  it('lands the message on the continuation, not the closed ticket', async () => {
    const original = await makeTicket({ status: 'CLOSED' });
    const { ticket: continuation } = await recordCustomerReply({
      ref: { id: original.id },
      bodyText: 'Hello again.',
    });

    expect(await prisma.message.count({ where: { ticketId: original.id } })).toBe(0);
    expect(await prisma.message.count({ where: { ticketId: continuation.id } })).toBe(1);
  });

  it('attributes the continuation to SYSTEM with no actor id', async () => {
    const original = await makeTicket({ status: 'CLOSED' });
    const { ticket: continuation } = await recordCustomerReply({
      ref: { id: original.id },
      bodyText: 'Hello again.',
    });

    const audit = await auditFor(continuation.id);
    expect(audit[0]).toMatchObject({
      action: 'ticket.continued',
      actorType: 'SYSTEM',
      actorId: null,
    });
  });
});

describe('assignment', () => {
  it('claims and unclaims without restricting anyone', async () => {
    const ticket = await makeTicket();

    const claimed = await setAssignee({
      ref: { id: ticket.id },
      actor: actor(),
      assigneeId: secondAgent.id,
    });
    expect(claimed.assigneeId).toBe(secondAgent.id);

    const unclaimed = await setAssignee({
      ref: { id: ticket.id },
      actor: actor(),
      assigneeId: null,
    });
    expect(unclaimed.assigneeId).toBeNull();

    const actions = (await auditFor(ticket.id)).map((event) => event.action);
    expect(actions).toEqual(['ticket.claimed', 'ticket.unclaimed']);
  });

  it('rejects an unknown assignee', async () => {
    const ticket = await makeTicket();
    await expect(
      setAssignee({
        ref: { id: ticket.id },
        actor: actor(),
        assigneeId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses to reassign a closed ticket', async () => {
    const ticket = await makeTicket({ status: 'CLOSED' });
    await expect(
      setAssignee({ ref: { id: ticket.id }, actor: actor(), assigneeId: secondAgent.id }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
  });
});

describe('category override', () => {
  it('preserves aiCategory, because the disagreement is the eval signal', async () => {
    const ticket = await makeTicket({ aiCategory: 'GENERAL_QUESTION' });

    const updated = await setTicketCategory({
      ref: { id: ticket.id },
      actor: actor(),
      category: 'REFUND_REQUEST',
    });

    expect(updated.category).toBe('REFUND_REQUEST');
    expect(updated.aiCategory).toBe('GENERAL_QUESTION');
    expect(updated.categoryCorrectedById).toBe(agent.id);
    expect(updated.categoryCorrectedAt).not.toBeNull();

    const audit = await auditFor(ticket.id);
    expect(audit[0]?.action).toBe('ticket.category_corrected');
  });

  it('is not a correction when it agrees with the classifier', async () => {
    const ticket = await makeTicket({ aiCategory: 'REFUND_REQUEST' });

    const updated = await setTicketCategory({
      ref: { id: ticket.id },
      actor: actor(),
      category: 'REFUND_REQUEST',
    });

    expect(updated.categoryCorrectedById).toBeNull();
    expect((await auditFor(ticket.id))[0]?.action).toBe('ticket.category_set');
  });

  it('clears a failed classification, since an agent choosing one is a classification', async () => {
    const ticket = await makeTicket();
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { classificationState: 'FAILED' },
    });

    const updated = await setTicketCategory({
      ref: { id: ticket.id },
      actor: actor(),
      category: 'TECHNICAL_QUESTION',
    });

    expect(updated.classificationState).toBe('DONE');
  });
});

/**
 * There used to be two timed sweeps here — a 7-day auto-resolve and a 14-day
 * auto-close. They were removed, and these tests exist so they cannot come back
 * by accident.
 *
 * The reason is that a queue which tidies itself reports a backlog smaller than
 * the one that exists, and the ticket it tidied away is precisely the one
 * nobody got to. Age is a reason to look at a ticket, not to close it.
 */
describe('no ticket changes status on its own', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  it('leaves a long-untouched ticket exactly where a human left it', async () => {
    const stale = await makeTicket({ waitingOn: 'CUSTOMER', lastOutboundAt: daysAgo(365) });
    const resolvedLongAgo = await makeTicket({ status: 'RESOLVED', resolvedAt: daysAgo(365) });

    // Everything the worker still runs on a tick. Under the old sweeps both of
    // these tickets moved; now nothing does.
    await sweepLoginAttempts(now);

    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe(
      'OPEN',
    );
    expect(
      (await prisma.ticket.findUniqueOrThrow({ where: { id: resolvedLongAgo.id } })).status,
    ).toBe('RESOLVED');
    // Nothing to explain in the audit log, because nothing happened.
    expect(await auditFor(stale.id)).toHaveLength(0);
  });

  it('exports no sweep that transitions a ticket', async () => {
    // A named guard against reintroduction: the module surface is the thing a
    // scheduler would have to reach for.
    const service: Record<string, unknown> = await import('./transition-service.js');

    expect(Object.keys(service).filter((name) => /sweep|auto/i.test(name))).toEqual([]);
  });
});

describe('addressing a ticket', () => {
  it('resolves by human-facing number as well as by id', async () => {
    const ticket = await makeTicket();
    const resolved = await resolveTicket({ ref: { number: ticket.number }, actor: actor() });
    expect(resolved.id).toBe(ticket.id);
  });

  it('404s on an unknown number', async () => {
    await expect(resolveTicket({ ref: { number: 999_999 }, actor: actor() })).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );
  });
});
