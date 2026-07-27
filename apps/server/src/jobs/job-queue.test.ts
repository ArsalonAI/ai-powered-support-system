import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectPrisma, prisma } from '../db/prisma.js';
import {
  backoffMs,
  claimNextJob,
  enqueueJob,
  failJob,
  hasJobInFlight,
  succeedJob,
} from './job-queue.js';

/**
 * The queue's whole correctness argument rests on one statement — the
 * `FOR UPDATE SKIP LOCKED` claim — so that is what these tests are pointed at.
 *
 * They run against real Postgres because there is nothing to test otherwise:
 * `SKIP LOCKED` is a database behaviour, and a mocked client would happily
 * confirm whatever the mock was written to believe.
 */

let ticketId: string;
let seq = 0;

async function makeTicket() {
  seq += 1;
  const customer = await prisma.customer.create({
    data: { email: `queue-${String(seq)}-${String(Date.now())}@example.com` },
  });
  const ticket = await prisma.ticket.create({
    data: { customerId: customer.id, subject: `Queue fixture ${String(seq)}` },
  });
  return ticket.id;
}

beforeEach(async () => {
  await prisma.job.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.message.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.customer.deleteMany();
  ticketId = await makeTicket();
});

afterAll(async () => {
  await prisma.job.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.customer.deleteMany();
  await disconnectPrisma();
});

describe('claimNextJob', () => {
  it('claims a due job, marks it RUNNING, and counts the attempt', async () => {
    const queued = await enqueueJob({ type: 'SUMMARIZE_TICKET', ticketId });

    const claimed = await claimNextJob();

    expect(claimed?.id).toBe(queued.id);
    expect(claimed?.status).toBe('RUNNING');
    // Counted at claim time, not at failure time: a job whose handler crashes
    // the process must not be retried forever on the next boot.
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.startedAt).not.toBeNull();
  });

  it('returns null when the queue is empty', async () => {
    expect(await claimNextJob()).toBeNull();
  });

  it('leaves a job scheduled for the future alone', async () => {
    await enqueueJob({
      type: 'SUMMARIZE_TICKET',
      ticketId,
      runAt: new Date(Date.now() + 60_000),
    });

    expect(await claimNextJob()).toBeNull();
  });

  /**
   * A guard on the timestamp conversion in the claim query. `jobs.runAt` is
   * `TIMESTAMP` without time zone, so a JS `Date` bound straight into the raw
   * SQL is re-read in the *session's* zone — off by the offset on any machine
   * that is not UTC, which makes every due job look scheduled for the future
   * and stops the queue without an error. Times have to survive the round trip
   * exactly.
   */
  it('treats runAt as UTC regardless of the database session timezone', async () => {
    const runAt = new Date('2026-07-27T19:17:48.558Z');
    const queued = await enqueueJob({ type: 'SUMMARIZE_TICKET', ticketId, runAt });

    const stored = await prisma.job.findUniqueOrThrow({ where: { id: queued.id } });
    expect(stored.runAt.toISOString()).toBe(runAt.toISOString());

    // An hour after that instant, the job is due — on any machine.
    const claimed = await claimNextJob(new Date(runAt.getTime() + 3_600_000));
    expect(claimed?.id).toBe(queued.id);

    // And an hour before it, it is not.
    await prisma.job.update({ where: { id: queued.id }, data: { status: 'PENDING' } });
    expect(await claimNextJob(new Date(runAt.getTime() - 3_600_000))).toBeNull();
  });

  it('claims oldest-first', async () => {
    const older = await enqueueJob({
      type: 'SUMMARIZE_TICKET',
      ticketId,
      runAt: new Date(Date.now() - 10_000),
    });
    await enqueueJob({ type: 'SUMMARIZE_TICKET', ticketId });

    expect((await claimNextJob())?.id).toBe(older.id);
  });

  /**
   * The test this file exists for. Two concurrent claims must return two
   * *different* jobs — never the same row twice. Without `SKIP LOCKED` this
   * either deadlocks or hands one job to both drains, and the second outcome is
   * the dangerous one: it looks like it worked.
   */
  it('never hands the same job to two concurrent claims', async () => {
    const queued = await Promise.all([
      enqueueJob({ type: 'SUMMARIZE_TICKET', ticketId }),
      enqueueJob({ type: 'SUMMARIZE_TICKET', ticketId }),
    ]);

    const [first, second] = await Promise.all([claimNextJob(), claimNextJob()]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.id).not.toBe(second?.id);
    expect(new Set([first?.id, second?.id])).toEqual(new Set(queued.map((job) => job.id)));
  });

  it('does not re-claim a job already RUNNING', async () => {
    await enqueueJob({ type: 'SUMMARIZE_TICKET', ticketId });

    await claimNextJob();

    expect(await claimNextJob()).toBeNull();
  });
});

describe('failJob', () => {
  it('reschedules a retryable failure with a later runAt and keeps the error', async () => {
    await enqueueJob({ type: 'SUMMARIZE_TICKET', ticketId });
    const claimed = await claimNextJob();

    const now = new Date();
    const outcome = await failJob(claimed!.id, new Error('rate limited'), {
      retryable: true,
      now,
    });

    expect(outcome.status).toBe('PENDING');
    expect(outcome.runAt!.getTime()).toBeGreaterThan(now.getTime());

    const stored = await prisma.job.findUniqueOrThrow({ where: { id: claimed!.id } });
    expect(stored.status).toBe('PENDING');
    expect(stored.lastError).toBe('rate limited');
    // Cleared, so the next claim's timestamp is the one that means anything.
    expect(stored.startedAt).toBeNull();
  });

  /**
   * A malformed request or a revoked key fails identically on every attempt.
   * Spending five of them — and the quota behind them — to learn that again is
   * the thing the taxonomy exists to prevent.
   */
  it('dead-letters a non-retryable failure on the first attempt', async () => {
    await enqueueJob({ type: 'SUMMARIZE_TICKET', ticketId });
    const claimed = await claimNextJob();

    const outcome = await failJob(claimed!.id, new Error('bad api key'), { retryable: false });

    expect(outcome.status).toBe('DEAD');
    const stored = await prisma.job.findUniqueOrThrow({ where: { id: claimed!.id } });
    expect(stored.status).toBe('DEAD');
    expect(stored.attempts).toBe(1);
    expect(stored.finishedAt).not.toBeNull();
  });

  it('dead-letters once maxAttempts is exhausted, even when retryable', async () => {
    const queued = await enqueueJob({ type: 'SUMMARIZE_TICKET', ticketId });
    await prisma.job.update({ where: { id: queued.id }, data: { maxAttempts: 2 } });

    // First failure: still has an attempt left.
    await claimNextJob();
    const first = await failJob(queued.id, new Error('flaky'), { retryable: true });
    expect(first.status).toBe('PENDING');

    // Second: attempts now equals maxAttempts, so this is the end of it.
    await prisma.job.update({ where: { id: queued.id }, data: { runAt: new Date() } });
    await claimNextJob();
    const second = await failJob(queued.id, new Error('flaky'), { retryable: true });

    expect(second.status).toBe('DEAD');
    const stored = await prisma.job.findUniqueOrThrow({ where: { id: queued.id } });
    expect(stored.attempts).toBe(2);
    expect(stored.lastError).toContain('gave up after 2 attempts');
  });
});

describe('backoffMs', () => {
  it('grows with each attempt and stays capped', () => {
    // Fixed "random" so the jitter does not make this flaky.
    const noJitter = () => 1;
    expect(backoffMs(1, noJitter)).toBe(5_000);
    expect(backoffMs(2, noJitter)).toBe(10_000);
    expect(backoffMs(3, noJitter)).toBe(20_000);
    expect(backoffMs(50, noJitter)).toBe(5 * 60_000);
  });

  it('jitters, so a batch that failed together does not wake together', () => {
    expect(backoffMs(3, () => 0)).toBeLessThan(backoffMs(3, () => 1));
  });
});

describe('hasJobInFlight', () => {
  it('is true while a job is queued or running and false once it settles', async () => {
    await enqueueJob({ type: 'SUMMARIZE_TICKET', ticketId });
    expect(await hasJobInFlight('SUMMARIZE_TICKET', ticketId)).toBe(true);

    const claimed = await claimNextJob();
    expect(await hasJobInFlight('SUMMARIZE_TICKET', ticketId)).toBe(true);

    await succeedJob(claimed!.id);
    expect(await hasJobInFlight('SUMMARIZE_TICKET', ticketId)).toBe(false);
  });

  it('does not confuse job types or tickets', async () => {
    const other = await makeTicket();
    await enqueueJob({ type: 'SUMMARIZE_TICKET', ticketId });

    expect(await hasJobInFlight('CLASSIFY_TICKET', ticketId)).toBe(false);
    expect(await hasJobInFlight('SUMMARIZE_TICKET', other)).toBe(false);
  });
});
