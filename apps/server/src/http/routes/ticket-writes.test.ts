import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedAgents } from '../../../prisma/seeds/users.js';
import { createApp } from '../../app.js';
import { ACTING_USER_HEADER } from '../../auth/acting-user.js';
import { disconnectPrisma, prisma } from '../../db/prisma.js';

/**
 * The write endpoints over HTTP. The state machine itself is covered in
 * `transition-service.test.ts`; what these assert is the wiring — that the
 * routes reach the transition service, that the acting-user seam attributes
 * writes to a real user, and that failures surface as the documented status
 * codes rather than as a 500.
 */

const app = createApp();

let alex: { id: string; name: string };
let maria: { id: string; name: string };
let customerId: string;
let seq = 0;

async function makeTicket(overrides: { status?: 'OPEN' | 'RESOLVED' | 'CLOSED' } = {}) {
  seq += 1;
  return prisma.ticket.create({
    data: {
      customerId,
      subject: `Write-path ticket ${seq}`,
      status: overrides.status ?? 'OPEN',
    },
  });
}

beforeAll(async () => {
  await seedAgents(prisma);
  const users = await prisma.user.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  alex = users[0]!;
  maria = users[1]!;
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
    data: { email: `writer-${seq}-${Date.now()}@example.com` },
  });
  customerId = customer.id;
});

afterAll(async () => {
  // Leave the database as we found it — see the note in transition-service.test.ts.
  await truncateTicketData();
  await disconnectPrisma();
});

describe('POST /api/tickets/:number/reply', () => {
  it('persists the reply and hands the ticket back to the customer', async () => {
    const ticket = await makeTicket();

    const response = await request(app)
      .post(`/api/tickets/${ticket.number}/reply`)
      .send({ bodyText: 'We are looking into it.', aiDrafted: false });

    expect(response.status).toBe(201);
    expect(response.body.waitingOn).toBe('CUSTOMER');
    expect(response.body.messages).toHaveLength(1);
    expect(response.body.messages[0]).toMatchObject({
      direction: 'OUTBOUND',
      bodyText: 'We are looking into it.',
      aiDrafted: false,
    });
  });

  // The seam has to write a real user id — the CHECK constraint on outbound
  // authors is the whole reason it exists.
  it('attributes the reply to the user named in the acting-user header', async () => {
    const ticket = await makeTicket();

    const response = await request(app)
      .post(`/api/tickets/${ticket.number}/reply`)
      .set(ACTING_USER_HEADER, maria.id)
      .send({ bodyText: 'Maria here.', aiDrafted: false });

    expect(response.status).toBe(201);
    expect(response.body.messages[0].author).toMatchObject({ id: maria.id, name: maria.name });
  });

  it('falls back to the first agent by name when the header is absent', async () => {
    const ticket = await makeTicket();

    const response = await request(app)
      .post(`/api/tickets/${ticket.number}/reply`)
      .send({ bodyText: 'No header set.', aiDrafted: false });

    expect(response.body.messages[0].author.id).toBe(alex.id);
  });

  // Silently attributing a reply to the wrong person is exactly what the author
  // column exists to prevent, so an unknown id is loud.
  it('rejects an unknown acting user rather than falling back', async () => {
    const ticket = await makeTicket();

    const response = await request(app)
      .post(`/api/tickets/${ticket.number}/reply`)
      .set(ACTING_USER_HEADER, '00000000-0000-0000-0000-000000000000')
      .send({ bodyText: 'Who am I?', aiDrafted: false });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
    expect(await prisma.message.count()).toBe(0);
  });

  it('rejects an empty reply', async () => {
    const ticket = await makeTicket();
    const response = await request(app)
      .post(`/api/tickets/${ticket.number}/reply`)
      .send({ bodyText: '', aiDrafted: false });

    expect(response.status).toBe(422);
  });

  it('rejects a reply that does not say whether it began as a draft', async () => {
    const ticket = await makeTicket();
    const response = await request(app)
      .post(`/api/tickets/${ticket.number}/reply`)
      .send({ bodyText: 'Silent on the flags.' });

    expect(response.status).toBe(422);
    expect(response.body.error.issues.map((i: { path: string }) => i.path)).toContain('aiDrafted');
  });

  it('rejects aiDrafted without the edited flag', async () => {
    const ticket = await makeTicket();
    const response = await request(app)
      .post(`/api/tickets/${ticket.number}/reply`)
      .send({ bodyText: 'Used the draft.', aiDrafted: true });

    expect(response.status).toBe(422);
    expect(response.body.error.issues.map((i: { path: string }) => i.path)).toContain(
      'aiDraftEdited',
    );
  });

  it('409s on a closed ticket', async () => {
    const ticket = await makeTicket({ status: 'CLOSED' });
    const response = await request(app)
      .post(`/api/tickets/${ticket.number}/reply`)
      .send({ bodyText: 'Anyone there?', aiDrafted: false });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ILLEGAL_TRANSITION');
  });

  it('404s on an unknown ticket', async () => {
    const response = await request(app)
      .post('/api/tickets/999999/reply')
      .send({ bodyText: 'Hello?', aiDrafted: false });

    expect(response.status).toBe(404);
  });
});

describe('resolve, close, and reopen', () => {
  it('walks a ticket open → resolved → closed', async () => {
    const ticket = await makeTicket();

    const resolved = await request(app).post(`/api/tickets/${ticket.number}/resolve`).send();
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('RESOLVED');

    const closed = await request(app)
      .post(`/api/tickets/${ticket.number}/close`)
      .send({ reason: 'duplicate' });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('CLOSED');
  });

  it('reopens a resolved ticket back into the queue', async () => {
    const ticket = await makeTicket({ status: 'RESOLVED' });

    const response = await request(app).post(`/api/tickets/${ticket.number}/reopen`).send();

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('OPEN');
    expect(response.body.waitingOn).toBe('US');
  });

  it('409s when reopening a closed ticket', async () => {
    const ticket = await makeTicket({ status: 'CLOSED' });
    const response = await request(app).post(`/api/tickets/${ticket.number}/reopen`).send();

    expect(response.status).toBe(409);
  });

  it('records every transition in the audit log with a named actor', async () => {
    const ticket = await makeTicket();
    await request(app)
      .post(`/api/tickets/${ticket.number}/resolve`)
      .set(ACTING_USER_HEADER, maria.id)
      .send();

    const events = await prisma.auditEvent.findMany({ where: { ticketId: ticket.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'ticket.resolved',
      actorType: 'USER',
      actorId: maria.id,
    });
  });
});

describe('PATCH /api/tickets/:number/assignee', () => {
  it('claims and unclaims', async () => {
    const ticket = await makeTicket();

    const claimed = await request(app)
      .patch(`/api/tickets/${ticket.number}/assignee`)
      .send({ assigneeId: maria.id });
    expect(claimed.status).toBe(200);
    expect(claimed.body.assignee).toMatchObject({ id: maria.id });

    const unclaimed = await request(app)
      .patch(`/api/tickets/${ticket.number}/assignee`)
      .send({ assigneeId: null });
    expect(unclaimed.body.assignee).toBeNull();
  });

  it('422s on a malformed assignee id', async () => {
    const ticket = await makeTicket();
    const response = await request(app)
      .patch(`/api/tickets/${ticket.number}/assignee`)
      .send({ assigneeId: 'not-a-uuid' });

    expect(response.status).toBe(422);
  });
});

describe('PATCH /api/tickets/:number/category', () => {
  it('sets the category and keeps what the classifier said', async () => {
    const ticket = await makeTicket();
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { aiCategory: 'GENERAL_QUESTION', category: 'GENERAL_QUESTION' },
    });

    const response = await request(app)
      .patch(`/api/tickets/${ticket.number}/category`)
      .send({ category: 'REFUND_REQUEST' });

    expect(response.status).toBe(200);
    expect(response.body.category).toBe('REFUND_REQUEST');
    expect(response.body.aiCategory).toBe('GENERAL_QUESTION');
  });

  it('422s on a category outside the enum', async () => {
    const ticket = await makeTicket();
    const response = await request(app)
      .patch(`/api/tickets/${ticket.number}/category`)
      .send({ category: 'BILLING' });

    expect(response.status).toBe(422);
  });
});
