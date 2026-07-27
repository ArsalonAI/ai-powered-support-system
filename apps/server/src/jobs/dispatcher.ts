import type { Job, JobType } from '@prisma/client';
import { aiClient, type AiClient } from '../ai/client.js';
import { AiError } from '../ai/errors.js';
import { runSummarizeJob } from '../ai/summarize.js';

/**
 * Which handler drains which job type.
 *
 * The registry is a `Record<JobType, …>` rather than a switch so that adding a
 * member to the Prisma enum fails the typecheck here instead of silently
 * producing a job type nothing drains — the kind of gap that looks like a
 * hanging queue rather than a missing case.
 */

export interface JobDeps {
  /** Injected so the summarize job can be tested without a key or a network call. */
  ai: AiClient;
}

export type JobHandler = (job: Job, deps: JobDeps) => Promise<void>;

/** The types whose phases have not arrived yet. Dead-letters rather than retrying forever. */
function notImplemented(task: string): JobHandler {
  return (job) => {
    throw new AiError(`${job.type} is not implemented yet — see task ${task}`, {
      retryable: false,
    });
  };
}

export const JOB_HANDLERS: Record<JobType, JobHandler> = {
  SUMMARIZE_TICKET: runSummarizeJob,
  CLASSIFY_TICKET: notImplemented('5.7'),
  DRAFT_REPLY: notImplemented('5.11'),
  SEND_EMAIL: notImplemented('6.8'),
};

export async function runJob(job: Job, deps: JobDeps = { ai: aiClient() }): Promise<void> {
  await JOB_HANDLERS[job.type](job, deps);
}

/**
 * Whether a failed job is worth another attempt.
 *
 * Only failures the AI taxonomy has classified are retried. Anything else that
 * reaches here — a bug in prompt assembly, a schema mismatch, a handler that
 * does not exist — is our own defect, and five more attempts produce five more
 * identical failures. Dead-lettering leaves it visible in `jobs.lastError`
 * instead of churning.
 */
export function isRetryableFailure(error: unknown): boolean {
  return error instanceof AiError && error.retryable;
}
