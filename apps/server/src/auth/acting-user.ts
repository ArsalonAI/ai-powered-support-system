import type { Request } from 'express';
import { isProduction } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../http/api-error.js';

/**
 * TEMPORARY — task 2.1. Deleted at task 3.13, not left behind a flag.
 *
 * Ticket work precedes authentication, so there is no `req.session.userId` to
 * attribute a write to. That is not a cosmetic gap: the database refuses the
 * alternative. `messages_outbound_author_ck` rejects an outbound message with a
 * NULL author and `audit_events_actor_ck` requires an `actorId` on any entry
 * attributed to a user, so message append, assignment, and audit events have
 * nothing to write without an identity.
 *
 * So this resolves a **real, active seeded agent**. Genuine user IDs reach the
 * database and the constraints stay honest — nothing here weakens a check to
 * accommodate the missing login.
 *
 * At 3.13 the body becomes `req.session.userId` and this file goes away. Every
 * call site that will one day want the logged-in user must go through here
 * rather than looking a user up on its own, so that swap stays a one-file change.
 */

export const ACTING_USER_HEADER = 'x-acting-user';

/** The subset of a user any write path needs. Never selects a password hash. */
const actingUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const;

export type ActingUser = {
  id: string;
  name: string;
  email: string;
  role: 'AGENT' | 'ADMIN';
};

/**
 * Called at boot, next to the storage driver, so a misconfiguration crashes
 * startup rather than surfacing on the first write.
 *
 * A header that lets any caller act as any user is a backdoor the moment it
 * reaches an environment with real sessions. Refusing here means it cannot get
 * there by omission — someone has to delete this function to deploy.
 */
export function assertActingUserSeamAllowed(): void {
  if (isProduction) {
    throw new Error(
      'The acting-user seam (task 2.1) is a development stand-in for authentication ' +
        'and must never run in production. Task 3.13 removes it once sessions exist.',
    );
  }
}

/**
 * Resolves the user a write is attributed to.
 *
 * An unrecognised header is a 400 rather than a silent fall back to the default
 * agent: quietly attributing a reply to the wrong person is exactly the failure
 * the author column exists to prevent.
 */
export async function getActingUser(req: Request): Promise<ActingUser> {
  assertActingUserSeamAllowed();

  const requestedId = req.header(ACTING_USER_HEADER)?.trim();

  if (requestedId) {
    const user = await prisma.user.findFirst({
      where: { id: requestedId, isActive: true },
      select: actingUserSelect,
    });
    if (!user) {
      throw ApiError.badRequest(
        `No active user with id ${requestedId} (${ACTING_USER_HEADER} header)`,
      );
    }
    return user;
  }

  // Deterministic default so an unset header does not silently rotate the
  // author between requests. Ordered by name, matching `GET /api/users`.
  const fallback = await prisma.user.findFirst({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: actingUserSelect,
  });

  if (!fallback) {
    throw ApiError.internal(
      'No active user exists to attribute this action to. Run `pnpm db:seed`.',
    );
  }

  return fallback;
}
