import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ticketFixtures } from '../../../prisma/seeds/ticket-fixtures.js';
import { seedTickets } from '../../../prisma/seeds/tickets.js';
import { seedAgents } from '../../../prisma/seeds/users.js';
import { createApp } from '../../app.js';
import { disconnectPrisma, prisma } from '../../db/prisma.js';

const app = createApp();

/**
 * Expectations are derived from the fixture source rather than hardcoded, so
 * growing the corpus does not silently turn these into assertions about
 * numbers nobody rechecked.
 */
const EXPECTED_DEFAULT_QUEUE = ticketFixtures.filter(
  (f) => f.status === 'OPEN' && f.waitingOn === 'US',
).length;

const outboundFixtures = ticketFixtures.flatMap((f) =>
  f.messages.filter((m) => m.direction === 'OUTBOUND'),
);
const EXPECTED_SENT = outboundFixtures.length;
const EXPECTED_AI_DRAFTED = outboundFixtures.filter((m) => m.aiDrafted).length;
const EXPECTED_EDITED = outboundFixtures.filter((m) => m.aiDrafted && m.aiDraftEdited).length;

/** Ticket numbers are autoincrement, so they are looked up, never assumed. */
let continuationNumber: number;
let previousNumber: number;

beforeAll(async () => {
  await seedAgents(prisma);
  await seedTickets(prisma);

  const continuationFixture = ticketFixtures.find((f) => f.previousTicketId);
  if (!continuationFixture?.previousTicketId) throw new Error('No continuation fixture');

  const [continuation, previous] = await Promise.all([
    prisma.ticket.findUniqueOrThrow({
      where: { id: continuationFixture.id },
      select: { number: true },
    }),
    prisma.ticket.findUniqueOrThrow({
      where: { id: continuationFixture.previousTicketId },
      select: { number: true },
    }),
  ]);
  continuationNumber = continuation.number;
  previousNumber = previous.number;
}, 60_000);

afterAll(async () => {
  await disconnectPrisma();
});

describe('GET /api/tickets', () => {
  it('serves the default agent queue: open, waiting on us, oldest first', async () => {
    const response = await request(app).get('/api/tickets?status=OPEN&waitingOn=US&sort=oldest');

    expect(response.status).toBe(200);
    expect(response.body.pageInfo.totalItems).toBe(EXPECTED_DEFAULT_QUEUE);

    const created = response.body.items.map((t: { createdAt: string }) => t.createdAt);
    expect(created).toEqual([...created].sort());
  });

  it('paginates server-side', async () => {
    const first = await request(app).get('/api/tickets?pageSize=10&page=1');
    const second = await request(app).get('/api/tickets?pageSize=10&page=2');

    expect(first.body.items).toHaveLength(10);
    expect(first.body.pageInfo).toMatchObject({
      page: 1,
      pageSize: 10,
      totalItems: ticketFixtures.length,
      totalPages: Math.ceil(ticketFixtures.length / 10),
    });
    // Distinct pages, not the same rows twice.
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
  });

  it('filters by category', async () => {
    const response = await request(app).get('/api/tickets?category=REFUND_REQUEST&pageSize=100');

    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    for (const ticket of response.body.items) {
      expect(ticket.category).toBe('REFUND_REQUEST');
    }
  });

  it('filters to unassigned tickets', async () => {
    const response = await request(app).get('/api/tickets?unassigned=true&pageSize=100');

    for (const ticket of response.body.items) {
      expect(ticket.assignee).toBeNull();
    }
  });

  it('rejects an unknown status with the standard validation error body', async () => {
    const response = await request(app).get('/api/tickets?status=NOPE');

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.issues[0].path).toBe('status');
  });

  it('rejects an oversized page size rather than letting it through', async () => {
    const response = await request(app).get('/api/tickets?pageSize=5000');

    expect(response.status).toBe(422);
    expect(response.body.error.issues[0].path).toBe('pageSize');
  });
});

describe('GET /api/tickets/:number', () => {
  it('returns the thread and the customer history', async () => {
    const response = await request(app).get(`/api/tickets/${continuationNumber}`);

    expect(response.status).toBe(200);
    expect(response.body.messages.length).toBeGreaterThan(0);
    expect(Array.isArray(response.body.customerHistory)).toBe(true);
  });

  // CLOSED is terminal: a reply opens a new ticket cross-linked to the original,
  // and both live on the same Gmail thread.
  it('cross-links a continuation ticket to the closed ticket it continues', async () => {
    const response = await request(app).get(`/api/tickets/${continuationNumber}`);

    expect(response.body.previousTicket).not.toBeNull();
    expect(response.body.previousTicket.number).toBe(previousNumber);
    expect(response.body.previousTicket.status).toBe('CLOSED');

    const previous = await request(app).get(`/api/tickets/${previousNumber}`);
    expect(previous.body.gmailThreadId).toBe(response.body.gmailThreadId);
  });

  it('returns 404 in the standard error body for an unknown number', async () => {
    const response = await request(app).get('/api/tickets/999999');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a non-numeric ticket number', async () => {
    const response = await request(app).get('/api/tickets/not-a-number');

    expect(response.status).toBe(422);
  });
});

describe('GET /api/users', () => {
  it('lists the seeded agents', async () => {
    const response = await request(app).get('/api/users');

    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThanOrEqual(3);
    expect(response.body.items[0]).toHaveProperty('role');
  });
});

// The hash must never leave the database. An explicit `select` is what enforces
// it; this asserts the enforcement rather than trusting it.
describe('password hashes', () => {
  it('never appear in any response', async () => {
    const responses = await Promise.all([
      request(app).get('/api/users'),
      request(app).get('/api/tickets?pageSize=100'),
      request(app).get(`/api/tickets/${continuationNumber}`),
    ]);

    for (const response of responses) {
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('$argon2');
    }
  });
});

describe('GET /api/stats', () => {
  it('derives AI adoption from the per-message flags', async () => {
    const response = await request(app).get('/api/stats');

    expect(response.status).toBe(200);
    expect(response.body.adoption).toMatchObject({
      sentReplies: EXPECTED_SENT,
      startedAsAiDraft: EXPECTED_AI_DRAFTED,
      editedBeforeSend: EXPECTED_EDITED,
    });
    expect(response.body.adoption.acceptanceRate).toBeCloseTo(
      EXPECTED_AI_DRAFTED / EXPECTED_SENT,
      3,
    );
  });

  it('counts the queue and the tickets needing a reply', async () => {
    const response = await request(app).get('/api/stats');

    expect(response.body.tickets).toBe(ticketFixtures.length);
    expect(response.body.queue.needsReply).toBe(EXPECTED_DEFAULT_QUEUE);
  });
});

describe('API documentation', () => {
  it('serves an OpenAPI document generated from the shared schemas', async () => {
    const response = await request(app).get('/api/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(Object.keys(response.body.paths)).toEqual(
      expect.arrayContaining(['/tickets', '/tickets/{number}', '/users', '/stats', '/health']),
    );
    expect(response.body.components.schemas).toHaveProperty('TicketDetail');
  });

  it('serves the Swagger UI', async () => {
    const response = await request(app).get('/api/docs/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger-ui');
  });
});
