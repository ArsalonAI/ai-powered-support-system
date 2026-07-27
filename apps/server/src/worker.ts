import { aiClient, assertAiConfigured } from './ai/client.js';
import { sweepLoginAttempts } from './auth/login-rate-limit.js';
import { disconnectPrisma } from './db/prisma.js';
import { drainQueue } from './jobs/drain.js';
import { acquireWorkerLock, type WorkerLock } from './jobs/worker-lock.js';
import { logger } from './observability/logger.js';

/**
 * The worker process. Started alongside the API by `pnpm dev`, and there must
 * be **exactly one** of it.
 *
 * It runs two independent loops:
 *
 * - **The job drain** (task 5.1) — claims AI work and runs it. This one *is*
 *   concurrency-safe, via `FOR UPDATE SKIP LOCKED`.
 * - **Housekeeping** — sweeps the rate limiter's own rows on a slow interval.
 *
 * Phase 6 adds the Gmail poller, which is **not** concurrency-safe: two pollers
 * racing on the same `historyId` double-create tickets, silently.
 *
 * That rule used to be enforced by asking people to run one command. It is now
 * enforced by a Postgres advisory lock — a second worker exits immediately —
 * which is what makes it safe for `pnpm dev` to start this automatically. An
 * AI feature that needs a human to remember a second terminal is a feature that
 * is off whenever they forget.
 *
 * **It does not touch ticket status.** The 7-day auto-resolve and 14-day
 * auto-close were removed: no ticket changes status without a person deciding
 * it should. Summarizing is not a status change.
 */

/** Nothing here is time-critical; the rows being dropped are already an hour stale. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * How long to wait after finding an empty queue. Short enough that a summarize
 * click feels responsive, long enough that an idle machine is not running a
 * query every second all day.
 */
const JOB_POLL_INTERVAL_MS = 2_000;

let sweeping = false;
let draining = false;

async function runSweeps(): Promise<void> {
  // Idempotent, but overlapping runs would still do redundant work if one ever
  // ran long against a large backlog.
  if (sweeping) {
    logger.warn('sweep still running, skipping this tick');
    return;
  }
  sweeping = true;

  try {
    // Login attempts past the rate limiter's window are read by nothing; the
    // table would otherwise grow forever on a row per sign-in attempt.
    const attempts = await sweepLoginAttempts(new Date());

    if (attempts > 0) {
      logger.info({ loginAttempts: attempts }, 'sweeps applied');
    } else {
      logger.debug('sweeps found nothing due');
    }
  } catch (error) {
    // A failed sweep must not kill the worker: the next tick retries, and
    // nothing downstream depends on it having run.
    logger.error({ err: error }, 'sweep failed');
  } finally {
    sweeping = false;
  }
}

/** The loop itself lives in `jobs/drain.ts`; this adds the single-flight guard. */
async function drainJobs(): Promise<void> {
  if (draining) return;
  draining = true;

  try {
    await drainQueue({ ai: aiClient() });
  } catch (error) {
    // A failure of the *queue itself* — the database went away mid-claim.
    // Same rule as the sweep: log it and let the next tick try again.
    logger.error({ err: error }, 'job drain failed');
  } finally {
    draining = false;
  }
}

// Fails the boot rather than the first job. A worker running without a key is a
// queue that silently fills up.
assertAiConfigured();

/**
 * Claim the right to be *the* worker before starting any loop.
 *
 * Exiting 0 rather than 1 is deliberate: a second worker is a normal outcome of
 * running `pnpm dev` twice, not a failure. It should read as "already covered",
 * not as a crash that makes someone go looking for a bug.
 */
const acquired: WorkerLock | null = await acquireWorkerLock();
if (!acquired) {
  logger.warn(
    'another worker already holds the lock for this database — exiting so there is exactly one',
  );
  await disconnectPrisma();
  process.exit(0);
}
// Re-bound so the shutdown handler below sees a non-nullable type: a hoisted
// function declaration does not inherit the narrowing from the guard above.
const lock: WorkerLock = acquired;

logger.info(
  { sweepIntervalMs: SWEEP_INTERVAL_MS, jobPollIntervalMs: JOB_POLL_INTERVAL_MS },
  'worker started',
);

// Once at boot so a restart picks up anything that came due while it was down.
void runSweeps();
void drainJobs();

const sweepTimer = setInterval(() => void runSweeps(), SWEEP_INTERVAL_MS);
const jobTimer = setInterval(() => void drainJobs(), JOB_POLL_INTERVAL_MS);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker shutting down');
  clearInterval(sweepTimer);
  clearInterval(jobTimer);
  // Released explicitly on a clean exit; Postgres drops it on its own if we die
  // without getting here, so a crash never locks out the replacement.
  await lock.release();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
