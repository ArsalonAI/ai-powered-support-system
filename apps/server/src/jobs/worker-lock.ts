import pg from 'pg';
import { env } from '../config/env.js';

/**
 * "Exactly one worker", enforced by Postgres rather than by a comment.
 *
 * The job queue is concurrency-safe on its own — `FOR UPDATE SKIP LOCKED` means
 * two drains never claim the same row. The Gmail poller arriving in Phase 6 is
 * not: two pollers racing on the same `historyId` double-create tickets, with
 * no error to notice. That is a data-corruption bug enforced, until now, by
 * someone remembering to run one command.
 *
 * This is the same move the schema makes with its CHECK constraints: an
 * invariant that fails *silently* when it is only enforced in code belongs in
 * the database. A second worker now exits immediately with a clear message
 * instead of quietly duplicating work.
 *
 * **The lock needs its own connection.** Advisory locks are session-scoped, and
 * Prisma pools — a lock taken on a pooled connection would be released the
 * moment that connection was recycled, which is the worst kind of bug: it holds
 * right up until it doesn't. A dedicated client held open for the process
 * lifetime is what makes the guarantee real, and it releases automatically when
 * the process dies, so a crashed worker never locks out its replacement.
 */

/**
 * Arbitrary but fixed. Advisory lock keys are a single global namespace per
 * database, so this only has to avoid colliding with any other key this
 * application takes — currently there are none.
 */
const WORKER_LOCK_KEY = 4_242_001;

let holder: pg.Client | undefined;

export interface WorkerLock {
  release: () => Promise<void>;
}

/**
 * Returns null when another worker already holds the lock. The caller decides
 * what to do about it — `worker.ts` exits.
 */
export async function acquireWorkerLock(): Promise<WorkerLock | null> {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  const result = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [WORKER_LOCK_KEY],
  );

  if (!result.rows[0]?.locked) {
    await client.end();
    return null;
  }

  holder = client;
  return {
    release: async () => {
      // Ending the connection releases the lock; the explicit unlock just makes
      // the intent legible in a query log.
      await client.query('SELECT pg_advisory_unlock($1)', [WORKER_LOCK_KEY]);
      await client.end();
      holder = undefined;
    },
  };
}

/** Test helper: is this process currently holding it? */
export function holdsWorkerLock(): boolean {
  return holder !== undefined;
}
