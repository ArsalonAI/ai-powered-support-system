import { sweepLoginAttempts } from './auth/login-rate-limit.js';
import { disconnectPrisma } from './db/prisma.js';
import { logger } from './observability/logger.js';

/**
 * The worker process. Started separately from the API (`pnpm dev:worker`), and
 * there must be **exactly one** of it.
 *
 * Phase 5 adds the job-queue drain, which is concurrency-safe via
 * `FOR UPDATE SKIP LOCKED`, and Phase 6 adds the Gmail poller, which is *not* —
 * two pollers racing on the same `historyId` double-create tickets. Starting a
 * second worker is the mistake that silently corrupts data, which is why this is
 * a deliberate second command rather than something `pnpm dev` fans out.
 *
 * **It no longer touches tickets.** The 7-day auto-resolve and 14-day auto-close
 * were removed: no ticket changes status without a person deciding it should.
 * What is left is housekeeping over the rate limiter's own rows, which is why
 * this process still exists today rather than waiting for Phase 5.
 */

/** Nothing here is time-critical; the rows being dropped are already an hour stale. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let running = false;

async function runSweeps(): Promise<void> {
  // Idempotent, but overlapping runs would still do redundant work if one ever
  // ran long against a large backlog.
  if (running) {
    logger.warn('sweep still running, skipping this tick');
    return;
  }
  running = true;

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
    running = false;
  }
}

logger.info({ intervalMs: SWEEP_INTERVAL_MS }, 'worker started');

// Once at boot so a restart picks up anything that came due while it was down.
void runSweeps();
const timer = setInterval(() => void runSweeps(), SWEEP_INTERVAL_MS);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker shutting down');
  clearInterval(timer);
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
