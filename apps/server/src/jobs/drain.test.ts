import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedAgents } from '../../prisma/seeds/users.js';
import type { AiClient } from '../ai/client.js';
import { AiError } from '../ai/errors.js';
import { createApp } from '../app.js';
import { disconnectPrisma, prisma } from '../db/prisma.js';
import {
  clearLoginAttempts,
  clearSessions,
  CSRF_HEADER,
  signIn,
  type SignedIn,
} from '../test/session.js';
import { drainQueue } from './drain.js';

/**
 * The whole path, end to end: an agent presses Summarize, the route queues a
 * job, the worker's drain claims and runs it, and the next read of the ticket
 * carries the summary.
 *
 * Only the Anthropic call itself is faked — everything else here is the real
 * route, the real queue, the real handler, and a real Postgres. That boundary
 * is deliberate: the suite must never need a key, and a test that can reach the
 * API is a test that can bill for a run.
 */

const app = createApp();

function fakeAi(respond: () => unknown): AiClient {
  return {
    completeStructured: () => {
      const result = respond();
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
}

let asAlex: SignedIn;
let customerId: string;
let seq = 0;

async function makeTicketWithThread() {
  seq += 1;
  const ticket = await prisma.ticket.create({
    data: { customerId, subject: `Drain fixture ${String(seq)}` },
  });
  await prisma.message.create({
    data: {
      ticketId: ticket.id,
      direction: 'INBOUND',
      bodyText: 'My refund for order 4417 still has not arrived.',
      aiDrafted: false,
      occurredAt: new Date(),
    },
  });
  return ticket;
}

async function truncate() {
  await prisma.job.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.message.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.customer.deleteMany();
}

beforeAll(async () => {
  await seedAgents(prisma);
  const user = await prisma.user.findFirstOrThrow({ select: { email: true } });
  await clearLoginAttempts();
  asAlex = await signIn(app, user.email);
}, 60_000);

beforeEach(async () => {
  await truncate();
  const customer = await prisma.customer.create({
    data: { email: `drain-${String(seq)}-${String(Date.now())}@example.com` },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await truncate();
  await clearSessions();
  await clearLoginAttempts();
  await disconnectPrisma();
});

describe('the summarize path, end to end', () => {
  it('goes from a button press to a summary on the ticket', async () => {
    const ticket = await makeTicketWithThread();

    // 1. The agent presses Summarize.
    const queued = await asAlex.agent
      .post(`/api/tickets/${ticket.number}/summarize`)
      .set(CSRF_HEADER, asAlex.csrfToken);

    expect(queued.status).toBe(202);
    expect(queued.body.summaryState).toBe('PENDING');
    expect(queued.body.summary).toBeNull();

    // 2. The worker drains.
    const result = await drainQueue({
      ai: fakeAi(() => ({ summary: 'Customer is chasing a refund on order 4417.' })),
    });
    expect(result).toEqual({ succeeded: 1, failed: 0 });

    // 3. The next read carries it.
    const after = await asAlex.agent.get(`/api/tickets/${ticket.number}`);
    expect(after.body.summaryState).toBe('READY');
    expect(after.body.summary).toBe('Customer is chasing a refund on order 4417.');
    expect(after.body.summaryGeneratedAt).not.toBeNull();
  });

  it('drains everything due in one pass', async () => {
    const tickets = [await makeTicketWithThread(), await makeTicketWithThread()];
    for (const ticket of tickets) {
      await asAlex.agent
        .post(`/api/tickets/${ticket.number}/summarize`)
        .set(CSRF_HEADER, asAlex.csrfToken);
    }

    const result = await drainQueue({ ai: fakeAi(() => ({ summary: 'Summarized.' })) });

    expect(result.succeeded).toBe(2);
    expect(await prisma.job.count({ where: { status: 'SUCCEEDED' } })).toBe(2);
  });

  /**
   * The behaviour the PRD asks for in the failure case: classification and
   * summarization never gate the agent. A dead-lettered job is a badge, not a
   * blocked ticket.
   */
  it('leaves the ticket fully workable when the job dead-letters', async () => {
    const ticket = await makeTicketWithThread();
    await asAlex.agent
      .post(`/api/tickets/${ticket.number}/summarize`)
      .set(CSRF_HEADER, asAlex.csrfToken);

    const result = await drainQueue({
      ai: fakeAi(() => new AiError('Anthropic rejected the API key', { retryable: false })),
    });
    expect(result).toEqual({ succeeded: 0, failed: 1 });

    const after = await asAlex.agent.get(`/api/tickets/${ticket.number}`);
    expect(after.body.summaryState).toBe('FAILED');
    expect(after.body.summary).toBeNull();

    // Still repliable, still resolvable — the ticket did not notice.
    const reply = await asAlex.agent
      .post(`/api/tickets/${ticket.number}/reply`)
      .set(CSRF_HEADER, asAlex.csrfToken)
      .send({ bodyText: 'Looking into your refund now.', aiDrafted: false });
    expect(reply.status).toBe(201);
  });

  it('a retryable failure leaves the job due again rather than dead', async () => {
    const ticket = await makeTicketWithThread();
    await asAlex.agent
      .post(`/api/tickets/${ticket.number}/summarize`)
      .set(CSRF_HEADER, asAlex.csrfToken);

    await drainQueue({
      ai: fakeAi(() => new AiError('Anthropic rate limit reached', { retryable: true })),
    });

    const job = await prisma.job.findFirstOrThrow({ where: { ticketId: ticket.id } });
    expect(job.status).toBe('PENDING');
    expect(job.attempts).toBe(1);

    // And the UI still says work is in progress, not that it failed.
    const after = await asAlex.agent.get(`/api/tickets/${ticket.number}`);
    expect(after.body.summaryState).toBe('PENDING');
  });

  it('one poisoned job does not stall the ones behind it', async () => {
    const [bad, good] = [await makeTicketWithThread(), await makeTicketWithThread()];
    for (const ticket of [bad, good]) {
      await asAlex.agent
        .post(`/api/tickets/${ticket.number}/summarize`)
        .set(CSRF_HEADER, asAlex.csrfToken);
    }

    let call = 0;
    const result = await drainQueue({
      ai: fakeAi(() => {
        call += 1;
        return call === 1
          ? new AiError('malformed request', { retryable: false })
          : { summary: 'The second one worked.' };
      }),
    });

    expect(result).toEqual({ succeeded: 1, failed: 1 });
    const after = await asAlex.agent.get(`/api/tickets/${good.number}`);
    expect(after.body.summary).toBe('The second one worked.');
  });
});
