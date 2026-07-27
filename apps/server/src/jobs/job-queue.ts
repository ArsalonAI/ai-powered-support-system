import type { Job, JobType, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';

/**
 * The job queue (task 5.1).
 *
 * A plain Postgres table drained by the single worker, rather than a job
 * library — see docs/tech-stack.md for the threshold at which that stops being
 * the right call. The whole design rests on one claim query, so that is where
 * the care goes.
 *
 * **`dedupeKey` is deliberately unused here.** It exists for Gmail message-ID
 * idempotency (task 6.5), where "never twice, ever" is exactly right. It is the
 * wrong tool for "don't queue a second summary while one is already running":
 * the column is globally unique with no expiry, so a key that succeeded once
 * would block that ticket from ever being summarized again. In-flight
 * de-duplication is a query — see `hasJobInFlight`.
 */

/**
 * The one genuinely dangerous detail in this file.
 *
 * Prisma maps `DateTime` to `TIMESTAMP(3)` — *without* time zone — and stores
 * the UTC wall clock in it. But binding a JS `Date` into `$queryRaw` sends a
 * `timestamptz`, so a comparison against one of those columns makes Postgres
 * re-read the stored value in the **session's** time zone. On a machine set to
 * anything but UTC, `"runAt" <= $1` is then off by the offset, and every due
 * job looks like it is scheduled for the future: the queue goes quiet and
 * nothing errors.
 *
 * So timestamps cross this boundary as ISO text and are converted back
 * explicitly — `::timestamptz AT TIME ZONE 'UTC'` yields the naive-UTC value
 * the column actually holds, on any machine.
 */
function asNaiveUtc(value: Date): string {
  return value.toISOString();
}

/** Retry schedule. Doubles per attempt, capped, so a bad afternoon does not become a hot loop. */
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Jitter matters more than it looks: a batch of jobs that fail together against
 * the same rate limit would otherwise wake together and fail together again.
 */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
  return Math.round(exponential * (0.5 + random() * 0.5));
}

export async function enqueueJob(params: {
  type: JobType;
  ticketId?: string;
  payload?: Prisma.InputJsonValue;
  /** Reserved for Gmail (6.5). Leave unset for everything else. */
  dedupeKey?: string;
  runAt?: Date;
}): Promise<Job> {
  return prisma.job.create({
    data: {
      type: params.type,
      ticketId: params.ticketId ?? null,
      payload: params.payload ?? {},
      dedupeKey: params.dedupeKey ?? null,
      ...(params.runAt ? { runAt: params.runAt } : {}),
    },
  });
}

/** Is there already unfinished work of this type for this ticket? */
export async function hasJobInFlight(type: JobType, ticketId: string): Promise<boolean> {
  const existing = await prisma.job.findFirst({
    where: { type, ticketId, status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Claim the next due job, or null when there is nothing to do.
 *
 * This is raw SQL because it has to be. `FOR UPDATE SKIP LOCKED` is what makes
 * the queue safe for concurrent drains — a second worker steps over the row the
 * first has locked instead of blocking on it or, far worse, handing the same
 * job to both — and Prisma's query API cannot express it. A read-then-update
 * through the ORM would look correct and hand out duplicates under load.
 *
 * One statement, so the select and the claim cannot be interleaved. Column
 * names are quoted camelCase: that is how the initial migration created them,
 * and unquoted identifiers would fold to lowercase and fail at runtime rather
 * than at typecheck.
 */
export async function claimNextJob(now: Date = new Date()): Promise<Job | null> {
  // Both sides of every timestamp comparison have to be naive UTC — see the
  // note on `asNaiveUtc`. Binding a JS Date directly here silently claims
  // nothing on any machine whose timezone is not UTC.
  const at = asNaiveUtc(now);

  const rows = await prisma.$queryRaw<Job[]>`
    UPDATE "jobs"
       SET "status"    = 'RUNNING',
           "startedAt" = ${at}::timestamptz AT TIME ZONE 'UTC',
           "attempts"  = "attempts" + 1,
           "updatedAt" = ${at}::timestamptz AT TIME ZONE 'UTC'
     WHERE "id" = (
       SELECT "id"
         FROM "jobs"
        WHERE "status" = 'PENDING'
          AND "runAt" <= ${at}::timestamptz AT TIME ZONE 'UTC'
        ORDER BY "runAt" ASC
          FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING *;
  `;

  return rows[0] ?? null;
}

export async function succeedJob(id: string, now: Date = new Date()): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { status: 'SUCCEEDED', finishedAt: now, lastError: null },
  });
}

/**
 * Record a failure and decide what happens next.
 *
 * Dead-lettering is not a failure of the queue — it is the queue refusing to
 * spend five attempts and the quota behind them re-sending a request the API
 * already rejected as malformed. `retryable` is the one bit the AI error
 * taxonomy exists to produce.
 */
export async function failJob(
  id: string,
  error: unknown,
  options: { retryable: boolean; now?: Date; random?: () => number } = { retryable: true },
): Promise<{ status: 'PENDING' | 'DEAD'; runAt: Date | null }> {
  const now = options.now ?? new Date();
  const job = await prisma.job.findUniqueOrThrow({
    where: { id },
    select: { attempts: true, maxAttempts: true },
  });

  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  if (!options.retryable || exhausted) {
    await prisma.job.update({
      where: { id },
      data: {
        status: 'DEAD',
        finishedAt: now,
        lastError: exhausted
          ? `${message} (gave up after ${String(job.attempts)} attempts)`
          : message,
      },
    });
    return { status: 'DEAD', runAt: null };
  }

  const runAt = new Date(now.getTime() + backoffMs(job.attempts, options.random));
  await prisma.job.update({
    where: { id },
    data: { status: 'PENDING', runAt, startedAt: null, lastError: message },
  });
  return { status: 'PENDING', runAt };
}
