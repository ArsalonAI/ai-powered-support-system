import { logger } from '../observability/logger.js';
import { isRetryableFailure, runJob, type JobDeps } from './dispatcher.js';
import { claimNextJob, failJob, succeedJob } from './job-queue.js';

/**
 * One pass of the queue: claim and run jobs until there is nothing due.
 *
 * Separate from `worker.ts` so it can be tested. The worker's own file is an
 * entry point — it binds signal handlers, starts timers, and asserts its
 * credentials at boot — and importing that to test the loop would start a
 * process rather than exercise a function.
 *
 * Draining to empty rather than one job per tick means a burst is worked at the
 * speed of the work, not the speed of the poll.
 */
export async function drainQueue(deps: JobDeps): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  for (;;) {
    const job = await claimNextJob();
    if (!job) return { succeeded, failed };

    const startedAt = Date.now();
    try {
      await runJob(job, deps);
      await succeedJob(job.id);
      succeeded += 1;
      logger.info(
        { jobId: job.id, type: job.type, ticketId: job.ticketId, ms: Date.now() - startedAt },
        'job succeeded',
      );
    } catch (error) {
      // A failing job must not stop the drain — the next one may be fine, and a
      // single poisoned payload should not stall everything behind it.
      failed += 1;
      const retryable = isRetryableFailure(error);
      const outcome = await failJob(job.id, error, { retryable });
      logger.warn(
        {
          jobId: job.id,
          type: job.type,
          ticketId: job.ticketId,
          attempts: job.attempts,
          outcome: outcome.status,
          retryAt: outcome.runAt,
          err: error,
        },
        outcome.status === 'DEAD' ? 'job dead-lettered' : 'job failed, will retry',
      );
    }
  }
}
