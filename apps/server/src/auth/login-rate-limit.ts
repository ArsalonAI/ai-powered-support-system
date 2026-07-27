import { prisma } from '../db/prisma.js';

/**
 * Task 3.8 — login throttling, per account *and* per IP, with exponential
 * backoff.
 *
 * **Backoff, not lockout.** A lockout policy hands an attacker a denial of
 * service against the support team: guess wrong five times against every
 * agent's address and nobody can log in during an incident. Backoff makes
 * guessing arithmetically hopeless while leaving the real user a way in after a
 * wait that grows only as long as the failures keep coming.
 *
 * Two buckets, both consulted, because each catches what the other misses: the
 * account bucket stops a slow spray against one address from many hosts, and
 * the IP bucket stops one host walking the whole user list.
 *
 * **State lives in Postgres**, in `login_attempts`, not in a process-local map.
 * The schema comment on that table is the reason: an in-memory counter forgets
 * every attempt on restart, and under `tsx watch` a restart is any file save.
 * A limiter that a developer resets by touching a file is not a limiter.
 */

/** Failures this many deep are free. Fat fingers and stale password managers. */
export const FREE_ATTEMPTS = 3;

/** First penalty, doubling per failure after the free ones. */
const BASE_DELAY_MS = 2_000;

/** Ceiling: 15 minutes. Long enough to be hopeless, short enough to wait out. */
const MAX_DELAY_MS = 15 * 60 * 1000;

/** Attempts older than this do not count — yesterday's typos do not accumulate. */
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Rows read per check. Far above any legitimate burst, and a bound on what a
 * flood against one address can make this query cost.
 */
const MAX_ROWS = 200;

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until the next attempt is permitted. `Retry-After`'s unit. */
  retryAfterSeconds: number;
}

/**
 * The email is lowercased but not otherwise normalized, and is recorded whether
 * or not an account exists. Skipping the row for unknown addresses would make
 * "was that address rate limited" an account-existence oracle.
 */
export function emailKeyFor(email: string): string {
  return email.trim().toLowerCase();
}

function delayFor(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  const doublings = failures - FREE_ATTEMPTS - 1;
  return Math.min(BASE_DELAY_MS * 2 ** doublings, MAX_DELAY_MS);
}

interface AttemptRow {
  emailKey: string;
  ipKey: string;
  succeeded: boolean;
  occurredAt: Date;
}

/**
 * How long one bucket is blocked for.
 *
 * A success in the account bucket wipes its history — the real user got in, so
 * the failures before it were theirs. The IP bucket has no such reset: a host
 * that knows one valid password should not be able to clear its record of
 * guessing at everyone else's by logging into its own account.
 */
function blockedUntil(rows: AttemptRow[], resetOnSuccess: boolean): number {
  let failures = 0;
  let lastFailureAt = 0;

  // Rows arrive newest first.
  for (const row of rows) {
    if (row.succeeded) {
      if (resetOnSuccess) break;
      continue;
    }
    failures += 1;
    lastFailureAt = Math.max(lastFailureAt, row.occurredAt.getTime());
  }

  if (failures === 0) return 0;
  const delay = delayFor(failures);
  return delay === 0 ? 0 : lastFailureAt + delay;
}

/**
 * Consulted before the password is verified, so a throttled attempt never
 * reaches argon2 — the CPU cost is itself something worth not handing out.
 */
export async function checkLoginRateLimit(
  keys: { email: string; ip: string },
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const emailKey = emailKeyFor(keys.email);
  const rows = await prisma.loginAttempt.findMany({
    where: {
      occurredAt: { gt: new Date(now.getTime() - WINDOW_MS) },
      OR: [{ emailKey }, { ipKey: keys.ip }],
    },
    orderBy: { occurredAt: 'desc' },
    take: MAX_ROWS,
    select: { emailKey: true, ipKey: true, succeeded: true, occurredAt: true },
  });

  const until = Math.max(
    blockedUntil(
      rows.filter((row) => row.emailKey === emailKey),
      true,
    ),
    blockedUntil(
      rows.filter((row) => row.ipKey === keys.ip),
      false,
    ),
  );

  const remaining = until - now.getTime();
  return remaining > 0
    ? { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) }
    : { allowed: true, retryAfterSeconds: 0 };
}

/**
 * One row per attempt, successful or not. Successes are recorded too: they are
 * what resets the account bucket, and a login history with only the failures in
 * it answers none of the questions an incident asks.
 */
export async function recordLoginAttempt(
  keys: { email: string; ip: string },
  succeeded: boolean,
): Promise<void> {
  await prisma.loginAttempt.create({
    data: { emailKey: emailKeyFor(keys.email), ipKey: keys.ip, succeeded },
  });
}

/**
 * Drops attempts past the window. Run from the worker's sweep tick — nothing
 * reads a row this old, and the table would otherwise grow without bound.
 */
export async function sweepLoginAttempts(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.loginAttempt.deleteMany({
    where: { occurredAt: { lt: new Date(now.getTime() - WINDOW_MS) } },
  });
  return count;
}
