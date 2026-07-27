import connectPgSimple from 'connect-pg-simple';
import type { RequestHandler } from 'express';
import session from 'express-session';
import pg from 'pg';
import { env, isProduction, isTest } from '../config/env.js';
import { logger } from '../observability/logger.js';

/**
 * Tasks 3.3 and 3.5 — server-side sessions in the same Postgres.
 *
 * The session is the only thing the browser holds. The cookie carries a signed
 * ID and nothing else: role, identity, and expiry all live in a row the client
 * cannot reach, which is what makes revocation (3.6) possible at all.
 */

/**
 * `express-session`'s `SessionData` is an open interface every module can
 * extend. Every field is optional because an unauthenticated visitor has a
 * session object too — typing `userId` as `string` would make `req.session.userId`
 * look present on the login page.
 */
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    /**
     * ms epoch. The hard ceiling from 3.5, stamped once at login. Rolling
     * renewal moves the cookie's expiry; nothing moves this.
     */
    absoluteExpiresAt?: number;
    /** The synchronizer token from 3.9, minted with the session. */
    csrfToken?: string;
  }
}

export const IDLE_TIMEOUT_MS = env.SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000;
export const ABSOLUTE_LIFETIME_MS = env.SESSION_ABSOLUTE_LIFETIME_HOURS * 60 * 60 * 1000;

/**
 * A second, small pool alongside Prisma's. `connect-pg-simple` speaks `pg`
 * directly and Prisma does not expose its pool, so this is the cost of using
 * the store the stack specifies. Three connections is ample: the store does one
 * query per request at most, and the API is a single process serving under
 * 50 tickets a day.
 */
const sessionPool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 3,
  // A session lookup that cannot get a connection should fail the request, not
  // queue behind Prisma's traffic until the client gives up.
  connectionTimeoutMillis: 5_000,
});

sessionPool.on('error', (error) => {
  // An idle client erroring out is a pool-level event with no request to attach
  // it to; unhandled, it takes the process down.
  logger.error({ err: error }, 'session pool client error');
});

const PgStore = connectPgSimple(session);

export const sessionStore: InstanceType<typeof PgStore> = new PgStore({
  pool: sessionPool,
  // The table is defined by the Prisma migration, with a `userId` foreign key
  // and its indexes. Letting the store create its own would produce a different
  // table with none of that, and `pnpm db:migrate` is the only thing that
  // creates schema here.
  tableName: 'session',
  createTableIfMissing: false,
  // Vitest would otherwise hold a timer open after the assertions finish, and
  // the test database is truncated between files anyway.
  pruneSessionInterval: isTest ? false : 15 * 60,
  errorLog: (message: string, error?: unknown) => logger.error({ err: error }, message),
});

/**
 * `secure` is conditional and that is a real gap, not an oversight: there is no
 * TLS on a developer machine, and a `secure` cookie over plain HTTP is simply
 * never sent, so the app would not work at all. The tech stack's hosting
 * section lists "TLS and a real `secure` session cookie" as one of the things a
 * deployment has to solve.
 */
export const sessionMiddleware: RequestHandler = session({
  name: 'support.sid',
  secret: env.SESSION_SECRET,
  store: sessionStore,
  // The store is the source of truth, so there is nothing to re-save on a
  // request that did not touch the session.
  resave: false,
  // No row, and no cookie, until someone actually logs in. An anonymous visitor
  // hitting the login page must not create a session row.
  saveUninitialized: false,
  // 3.5: every response re-stamps the cookie, so the idle window is measured
  // from last activity rather than from login.
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: IDLE_TIMEOUT_MS,
    path: '/',
  },
});

/** Called from the API's shutdown path so the extra pool does not outlive it. */
export async function closeSessionPool(): Promise<void> {
  await sessionPool.end();
}
