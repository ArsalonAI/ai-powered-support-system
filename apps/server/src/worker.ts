import { disconnectPrisma } from './db/prisma.js';
import { logger } from './observability/logger.js';
import { sweepAutoClose, sweepAutoResolve } from './tickets/transition-service.js';

/**
 * The worker process. Started separately from the API (`pnpm dev:worker`), and
 * there must be **exactly one** of it.
 *
 * Today it runs the timed sweeps. Phase 5 adds the job-queue drain, which is
 * concurrency-safe via `FOR UPDATE SKIP LOCKED`, and Phase 6 adds the Gmail
 * poller, which is *not* — two pollers racing on the same `historyId`
 * double-create tickets. Starting a second worker is the mistake that silently
 * corrupts data, which is why this is a deliberate second command rather than
 * something `pnpm dev` fans out.
 *
 * The sweep logic itself lives in the transition service, not here: a scheduler
 * that owns business rules cannot be tested without waiting for its schedule.
 */

/** Seven- and fourteen-day thresholds do not need a tight loop. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let running = false;

async function runSweeps(): Promise<void> {
  // The sweeps are idempotent, but overlapping runs would still do redundant
  // work if one ever ran long against a large backlog.
  if (running) {
    logger.warn('sweep still running, skipping this tick');
    return;
  }
  running = true;

  try {
    const now = new Date();
    const resolved = await sweepAutoResolve(now);
    const closed = await sweepAutoClose(now);

    if (resolved.length > 0 || closed.length > 0) {
      logger.info({ autoResolved: resolved.length, autoClosed: closed.length }, 'sweeps applied');
    } else {
      logger.debug('sweeps found nothing due');
    }
  } catch (error) {
    // A failed sweep must not kill the worker: the next tick retries, and the
    // tickets it would have moved are still visible and workable meanwhile.
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
