import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedAgents } from '../../../prisma/seeds/users.js';
import { createApp } from '../../app.js';
import { disconnectPrisma, prisma } from '../../db/prisma.js';
import {
  clearLoginAttempts,
  clearSessions,
  CSRF_HEADER,
  signIn,
  type SignedIn,
} from '../../test/session.js';

/**
 * The write endpoints over HTTP. The state machine itself is covered in
 * `transition-service.test.ts`; what these assert is the wiring — that the
 * routes reach the transition service, that the write is attributed to the
 * signed-in user, and that failures surface as the documented status codes
 * rather than as a 500.
 *
 * Every request here carries a session. Task 3.10 put the whole ticket router
 * behind `requireAuth`, which is also why the last test in the reply block
 * exists: an unauthenticated write must not reach the database at all.
 */

const app = createApp();

let alex: { id: string; name: string };
let maria: { id: string; name: string };
let asAlex: SignedIn;
let asMaria: SignedIn;
let customerId: string;
let seq = 0;

/** A state-changing request as a given user, with that session's CSRF token. */
function write(session: SignedIn, method: 'post' | 'patch', path: string) {
  return session.agent[method](path).set(CSRF_HEADER, session.csrfToken);
}

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
    select: { id: true, name: true, email: true },
  });
  alex = users[0]!;
  maria = users[1]!;

  await clearLoginAttempts();
  asAlex = await signIn(app, users[0]!.email);
  asMaria = await signIn(app, users[1]!.email);
}, 60_000);

/** Order matters: audit actors and message authors are ON DELETE RESTRICT. */
async function truncateTicketData() {
  await prisma.job.deleteMany();
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
  await clearSessions();
  await clearLoginAttempts();
  await disconnectPrisma();
});

describe('POST /api/tickets/:number/reply', () => {
  it('persists the reply and hands the ticket back to the customer', async () => {
    const ticket = await makeTicket();

    const response = await write(asAlex, 'post', `/api/tickets/${ticket.number}/reply`).send({
      bodyText: 'We are looking into it.',
      aiDrafted: false,
    });

    expect(response.status).toBe(201);
    expect(response.body.waitingOn).toBe('CUSTOMER');
    expect(response.body.messages).toHaveLength(1);
    expect(response.body.messages[0]).toMatchObject({
      direction: 'OUTBOUND',
      bodyText: 'We are looking into it.',
      aiDrafted: false,
    });
  });

  // A real user id has to reach the database — the CHECK constraint on outbound
  // authors is what makes "the AI never sends" enforceable rather than a policy.
  it('attributes the reply to the signed-in user', async () => {
    const ticket = await makeTicket();

    const response = await write(asMaria, 'post', `/api/tickets/${ticket.number}/reply`).send({
      bodyText: 'Maria here.',
      aiDrafted: false,
    });

    expect(response.status).toBe(201);
    expect(response.body.messages[0].author).toMatchObject({ id: maria.id, name: maria.name });
  });

  it('two agents replying are recorded as two different authors', async () => {
    const ticket = await makeTicket();

    await write(asAlex, 'post', `/api/tickets/${ticket.number}/reply`).send({
      bodyText: 'Alex first.',
      aiDrafted: false,
    });
    const second = await write(asMaria, 'post', `/api/tickets/${ticket.number}/reply`).send({
      bodyText: 'Maria second.',
      aiDrafted: false,
    });

    expect(second.body.messages.map((m: { author: { id: string } }) => m.author.id)).toEqual([
      alex.id,
      maria.id,
    ]);
  });

  // Task 3.10. Before Phase 3 this route was writable by anyone who could reach
  // it; the point of the wrapping in app.ts is that it no longer is.
  it('rejects an unauthenticated write without touching the database', async () => {
    const ticket = await makeTicket();

    const response = await request(app)
      .post(`/api/tickets/${ticket.number}/reply`)
      .send({ bodyText: 'Who am I?', aiDrafted: false });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(await prisma.message.count()).toBe(0);
  });

  // Task 3.9. A session cookie alone is not authorization to write: the browser
  // attaches it to requests another site caused too.
  it('rejects a write from a valid session with no CSRF token', async () => {
    const ticket = await makeTicket();

    const response = await asAlex.agent
      .post(`/api/tickets/${ticket.number}/reply`)
      .send({ bodyText: 'No token.', aiDrafted: false });

    expect(response.status).toBe(403);
    expect(await prisma.message.count()).toBe(0);
  });

  it('rejects an empty reply', async () => {
    const ticket = await makeTicket();
    const response = await write(asAlex, 'post', `/api/tickets/${ticket.number}/reply`).send({
      bodyText: '',
      aiDrafted: false,
    });

    expect(response.status).toBe(422);
  });

  it('rejects a reply that does not say whether it began as a draft', async () => {
    const ticket = await makeTicket();
    const response = await write(asAlex, 'post', `/api/tickets/${ticket.number}/reply`).send({
      bodyText: 'Silent on the flags.',
    });

    expect(response.status).toBe(422);
    expect(response.body.error.issues.map((i: { path: string }) => i.path)).toContain('aiDrafted');
  });

  it('rejects aiDrafted without the edited flag', async () => {
    const ticket = await makeTicket();
    const response = await write(asAlex, 'post', `/api/tickets/${ticket.number}/reply`).send({
      bodyText: 'Used the draft.',
      aiDrafted: true,
    });

    expect(response.status).toBe(422);
    expect(response.body.error.issues.map((i: { path: string }) => i.path)).toContain(
      'aiDraftEdited',
    );
  });

  it('409s on a closed ticket', async () => {
    const ticket = await makeTicket({ status: 'CLOSED' });
    const response = await write(asAlex, 'post', `/api/tickets/${ticket.number}/reply`).send({
      bodyText: 'Anyone there?',
      aiDrafted: false,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ILLEGAL_TRANSITION');
  });

  it('404s on an unknown ticket', async () => {
    const response = await write(asAlex, 'post', '/api/tickets/999999/reply').send({
      bodyText: 'Hello?',
      aiDrafted: false,
    });

    expect(response.status).toBe(404);
  });
});

describe('resolve, close, and reopen', () => {
  it('walks a ticket open → resolved → closed', async () => {
    const ticket = await makeTicket();

    const resolved = await write(asAlex, 'post', `/api/tickets/${ticket.number}/resolve`).send();
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('RESOLVED');

    const closed = await write(asAlex, 'post', `/api/tickets/${ticket.number}/close`).send({
      reason: 'duplicate',
    });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('CLOSED');
  });

  it('reopens a resolved ticket back into the queue', async () => {
    const ticket = await makeTicket({ status: 'RESOLVED' });

    const response = await write(asAlex, 'post', `/api/tickets/${ticket.number}/reopen`).send();

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('OPEN');
    expect(response.body.waitingOn).toBe('US');
  });

  it('409s when reopening a closed ticket', async () => {
    const ticket = await makeTicket({ status: 'CLOSED' });
    const response = await write(asAlex, 'post', `/api/tickets/${ticket.number}/reopen`).send();

    expect(response.status).toBe(409);
  });

  it('records every transition in the audit log with a named actor', async () => {
    const ticket = await makeTicket();
    await write(asMaria, 'post', `/api/tickets/${ticket.number}/resolve`).send();

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

    const claimed = await write(asAlex, 'patch', `/api/tickets/${ticket.number}/assignee`).send({
      assigneeId: maria.id,
    });
    expect(claimed.status).toBe(200);
    expect(claimed.body.assignee).toMatchObject({ id: maria.id });

    const unclaimed = await write(asAlex, 'patch', `/api/tickets/${ticket.number}/assignee`).send({
      assigneeId: null,
    });
    expect(unclaimed.body.assignee).toBeNull();
  });

  it('422s on a malformed assignee id', async () => {
    const ticket = await makeTicket();
    const response = await write(asAlex, 'patch', `/api/tickets/${ticket.number}/assignee`).send({
      assigneeId: 'not-a-uuid',
    });

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

    const response = await write(asAlex, 'patch', `/api/tickets/${ticket.number}/category`).send({
      category: 'REFUND_REQUEST',
    });

    expect(response.status).toBe(200);
    expect(response.body.category).toBe('REFUND_REQUEST');
    expect(response.body.aiCategory).toBe('GENERAL_QUESTION');
  });

  it('422s on a category outside the enum', async () => {
    const ticket = await makeTicket();
    const response = await write(asAlex, 'patch', `/api/tickets/${ticket.number}/category`).send({
      category: 'BILLING',
    });

    expect(response.status).toBe(422);
  });
});

/**
 * The route only *queues* the summary — the worker writes it. So what these
 * assert is the queueing: that one job lands, that a second click does not
 * stack another on top, and that the response tells the client to start
 * watching.
 */
describe('POST /api/tickets/:number/summarize', () => {
  const summarizeJobs = (ticketId: string) =>
    prisma.job.findMany({ where: { ticketId, type: 'SUMMARIZE_TICKET' } });

  it('queues a job and reports the ticket as pending', async () => {
    const ticket = await makeTicket();

    const response = await write(asAlex, 'post', `/api/tickets/${ticket.number}/summarize`);

    // 202, not 201: nothing has been written to the ticket yet.
    expect(response.status).toBe(202);
    expect(response.body.summaryState).toBe('PENDING');
    expect(response.body.summary).toBeNull();

    const jobs = await summarizeJobs(ticket.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'PENDING', type: 'SUMMARIZE_TICKET' });
  });

  // A double-click is not two intents.
  it('does not stack a second job while one is in flight', async () => {
    const ticket = await makeTicket();

    await write(asAlex, 'post', `/api/tickets/${ticket.number}/summarize`);
    const second = await write(asAlex, 'post', `/api/tickets/${ticket.number}/summarize`);

    expect(second.status).toBe(202);
    expect(await summarizeJobs(ticket.id)).toHaveLength(1);
  });

  /**
   * Re-summarizing a grown thread is the normal case, and it is why the route
   * de-duplicates on an in-flight query rather than on the `dedupeKey` column —
   * that key is unique forever, so it would make the first summary the only one
   * this ticket could ever have.
   */
  it('queues again once the previous job has finished', async () => {
    const ticket = await makeTicket();

    await write(asAlex, 'post', `/api/tickets/${ticket.number}/summarize`);
    const [first] = await summarizeJobs(ticket.id);
    await prisma.job.update({
      where: { id: first!.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date() },
    });

    await write(asAlex, 'post', `/api/tickets/${ticket.number}/summarize`);

    expect(await summarizeJobs(ticket.id)).toHaveLength(2);
  });

  it('surfaces a dead-lettered job as FAILED without touching the ticket', async () => {
    const ticket = await makeTicket();
    await write(asAlex, 'post', `/api/tickets/${ticket.number}/summarize`);
    const [job] = await summarizeJobs(ticket.id);
    await prisma.job.update({
      where: { id: job!.id },
      data: { status: 'DEAD', lastError: 'bad api key', finishedAt: new Date() },
    });

    const response = await asAlex.agent.get(`/api/tickets/${ticket.number}`);

    expect(response.body.summaryState).toBe('FAILED');
    // Classification and summarization never gate the agent: the ticket is
    // exactly as workable as it was before.
    expect(response.body.status).toBe('OPEN');
    expect(response.body.summary).toBeNull();
  });

  it('404s on a ticket that does not exist, and queues nothing', async () => {
    const response = await write(asAlex, 'post', '/api/tickets/999999/summarize');

    expect(response.status).toBe(404);
    expect(await prisma.job.count()).toBe(0);
  });

  it('rejects an unauthenticated caller', async () => {
    const ticket = await makeTicket();

    const response = await request(app).post(`/api/tickets/${ticket.number}/summarize`);

    expect(response.status).toBe(401);
    expect(await prisma.job.count()).toBe(0);
  });

  it('rejects a request with no CSRF token', async () => {
    const ticket = await makeTicket();

    const response = await asAlex.agent.post(`/api/tickets/${ticket.number}/summarize`);

    expect(response.status).toBe(403);
    expect(await prisma.job.count()).toBe(0);
  });
});
