import { prisma } from '../db/prisma.js';

/**
 * Task 3.6 — sessions queryable, and therefore revocable, by user ID.
 *
 * This is the requirement that makes deactivation mean something. The PRD
 * deactivates departed users rather than deleting them; if their cookie keeps
 * authenticating until it expires on its own, deactivation is a label on a row
 * and nothing more.
 *
 * `connect-pg-simple` owns `sid` / `sess` / `expire` and knows nothing about
 * `userId`, so the application stamps that column itself at login. Reading the
 * owner out of the `sess` JSON instead would work for one row at a time and be
 * unindexable across the table — which is exactly the query revocation needs.
 */

export interface SessionSummary {
  sid: string;
  expiresAt: Date;
}

/**
 * Called immediately after login, once the session row exists. Separate from
 * writing `req.session.userId` because the two live in different places: the
 * session payload is what the request reads, this column is what revocation
 * searches.
 */
export async function stampSessionOwner(sid: string, userId: string): Promise<void> {
  await prisma.session.updateMany({ where: { sid }, data: { userId } });
}

/**
 * Live sessions for a user, newest expiry first.
 *
 * A session dies two ways and both are checked here. `expire` is the *idle*
 * window, which `rolling: true` pushes forward on every request; the hard
 * ceiling is `absoluteExpiresAt` inside the session payload. Filtering on
 * `expire` alone would list a session that is past its absolute lifetime and
 * therefore cannot authenticate — `requireAuth` destroys it on its next
 * request — as though it were live. "Am I still signed in on the office
 * laptop?" has to answer no in that case.
 */
export async function listSessionsForUser(userId: string): Promise<SessionSummary[]> {
  const now = new Date();

  const rows = await prisma.session.findMany({
    where: { userId, expire: { gt: now } },
    orderBy: { expire: 'desc' },
    select: { sid: true, expire: true, sess: true },
  });

  return rows
    .filter((row) => {
      // A row with no stamp predates the field; `requireAuth` treats that as
      // expired rather than immortal, and so does this.
      const absolute = (row.sess as { absoluteExpiresAt?: number } | null)?.absoluteExpiresAt ?? 0;
      return absolute > now.getTime();
    })
    .map((row) => ({ sid: row.sid, expiresAt: row.expire }));
}

/**
 * Deletes every session belonging to a user and returns how many went. The
 * caller decides why — deactivation (4.3), password reset (4.6), or a "sign out
 * everywhere" action.
 *
 * `exceptSid` keeps the caller's own session alive, for the password-change
 * case where signing yourself out mid-flow is just annoying.
 */
export async function revokeSessionsForUser(
  userId: string,
  options: { exceptSid?: string } = {},
): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: {
      userId,
      ...(options.exceptSid ? { sid: { not: options.exceptSid } } : {}),
    },
  });
  return result.count;
}
