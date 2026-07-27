import type { Express } from 'express';
import request from 'supertest';
import { CSRF_HEADER, type SessionResponse } from '@support/shared';
import { SEED_AGENT_PASSWORD } from '../../prisma/seeds/users.js';
import { prisma } from '../db/prisma.js';

/**
 * Signing in, for the tests of everything that now sits behind a session.
 *
 * Phase 2's route tests drove the API directly because there was nothing in the
 * way. From 3.10 there is, and rewriting each of them to hand-roll a login
 * would spread the auth contract across every test file.
 */

/** `request.agent` keeps the cookie jar across calls, which is the whole point. */
export type SignedInAgent = ReturnType<typeof request.agent>;

export interface SignedIn {
  agent: SignedInAgent;
  /** Every state-changing request needs this in `x-csrf-token`. */
  csrfToken: string;
  session: SessionResponse;
}

export async function signIn(
  app: Express,
  email: string,
  password: string = SEED_AGENT_PASSWORD,
): Promise<SignedIn> {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/login').send({ email, password });

  if (response.status !== 200) {
    throw new Error(
      `signIn(${email}) failed with ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }

  const session = response.body as SessionResponse;
  return { agent, csrfToken: session.csrfToken, session };
}

/**
 * The rate limiter is durable by design (task 3.8), so its rows outlive the
 * test that created them. A file that deliberately fails a few logins would
 * otherwise throttle the file that runs after it — the IP bucket is shared, and
 * a success does not clear it.
 */
export async function clearLoginAttempts(): Promise<void> {
  await prisma.loginAttempt.deleteMany();
}

/** Sessions are rows; a file that logs in leaves them behind. */
export async function clearSessions(): Promise<void> {
  await prisma.session.deleteMany();
}

export { CSRF_HEADER };
