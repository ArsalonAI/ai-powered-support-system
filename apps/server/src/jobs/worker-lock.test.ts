import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { acquireWorkerLock, holdsWorkerLock, type WorkerLock } from './worker-lock.js';

/**
 * "Exactly one worker" used to be a rule people had to remember. These assert
 * that Postgres enforces it instead.
 *
 * The failure this prevents is not noisy: two Gmail pollers in Phase 6 quietly
 * double-create tickets, with no error anywhere. So the interesting case is the
 * *second* acquisition failing, and the lock surviving nothing but a real
 * process exit.
 */

const held: WorkerLock[] = [];

async function acquire(): Promise<WorkerLock | null> {
  const lock = await acquireWorkerLock();
  if (lock) held.push(lock);
  return lock;
}

afterEach(async () => {
  // Never leave one behind: an advisory lock outlives a failed test for as long
  // as its connection stays open, and would fail every test after it.
  while (held.length > 0) await held.pop()!.release();
});

describe('acquireWorkerLock', () => {
  it('grants the lock when nothing holds it', async () => {
    const lock = await acquire();

    expect(lock).not.toBeNull();
    expect(holdsWorkerLock()).toBe(true);
  });

  // The whole point: a second worker must not simply start alongside the first.
  it('refuses a second holder while the first is alive', async () => {
    const first = await acquire();
    expect(first).not.toBeNull();

    expect(await acquire()).toBeNull();
  });

  it('hands the lock to the next caller once released', async () => {
    const first = await acquire();
    await first!.release();
    held.pop();

    const second = await acquire();
    expect(second).not.toBeNull();
  });

  /**
   * The property that makes a crashed worker recoverable: the lock lives on the
   * *connection*, so losing the process releases it with nothing having to run
   * on the way down. Without this, one `kill -9` would lock out every
   * replacement until someone restarted Postgres.
   *
   * Simulated with a raw client standing in for the dying worker — it takes the
   * lock and drops its socket without ever unlocking, which is exactly what a
   * killed process does.
   */
  it('releases when a holder dies without unlocking', async () => {
    const dying = new pg.Client({ connectionString: env.DATABASE_URL });
    await dying.connect();
    const taken = await dying.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(4242001) AS locked',
    );
    expect(taken.rows[0]?.locked).toBe(true);

    // While it lives, nobody else gets in.
    expect(await acquire()).toBeNull();

    // It dies. No unlock, no shutdown handler — just a closed socket.
    await dying.end();

    expect(await acquire()).not.toBeNull();
  });
});
