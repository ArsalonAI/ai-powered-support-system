import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CSRF_HEADER, GENERIC_LOGIN_FAILURE } from '@support/shared';
import { createApp } from '../../app.js';
import { hashPassword } from '../../auth/password.js';
import { listSessionsForUser, revokeSessionsForUser } from '../../auth/session-registry.js';
import { disconnectPrisma, prisma } from '../../db/prisma.js';
import { clearLoginAttempts, clearSessions, signIn } from '../../test/session.js';

/**
 * Task 3.12 — the tests that exist because every one of these defences fails
 * *silently*. The app signs people in and out perfectly with session fixation,
 * un-revocable sessions, no throttling, and a timing oracle all in place. None
 * of them shows up in manual testing, so none of them is caught by anything but
 * an assertion.
 */

const app = createApp();

const PASSWORD = 'harbour-lantern-thistle-9';
const OTHER_PASSWORD = 'quarry-mistral-fennel-2';

let activeUser: { id: string; email: string };
let secondUser: { id: string; email: string };
let adminUser: { id: string; email: string };

async function makeUser(
  email: string,
  overrides: { password?: string | null; role?: 'AGENT' | 'ADMIN'; isActive?: boolean } = {},
) {
  const { password = PASSWORD, role = 'AGENT', isActive = true } = overrides;
  return prisma.user.create({
    data: {
      email,
      name: email.split('@')[0]!,
      role,
      isActive,
      passwordHash: password === null ? null : await hashPassword(password),
    },
    select: { id: true, email: true },
  });
}

/** Reads the session row express-session wrote, to assert on what it actually stored. */
async function sessionRow(sid: string) {
  return prisma.session.findUnique({ where: { sid } });
}

/** The `support.sid` cookie value from a response, or undefined if none was set. */
function sidCookie(headers: Record<string, unknown>): string | undefined {
  const cookies = (headers['set-cookie'] as string[] | undefined) ?? [];
  const cookie = cookies.find((value) => value.startsWith('support.sid='));
  if (!cookie) return undefined;
  // `s:<sid>.<signature>` — the signed form. The sid is up to the first dot.
  return decodeURIComponent(cookie.split(';')[0]!.split('=')[1]!).replace(/^s:/, '').split('.')[0];
}

beforeAll(async () => {
  await clearSessions();
  await prisma.user.deleteMany({ where: { email: { endsWith: '@authtest.local' } } });

  activeUser = await makeUser('active@authtest.local');
  secondUser = await makeUser('second@authtest.local', { password: OTHER_PASSWORD });
  adminUser = await makeUser('admin@authtest.local', { role: 'ADMIN' });
}, 60_000);

afterEach(async () => {
  // The limiter is durable by design, so one describe block's failed logins
  // would otherwise throttle the next.
  await clearLoginAttempts();
});

afterAll(async () => {
  await clearSessions();
  await clearLoginAttempts();
  await prisma.user.deleteMany({ where: { email: { endsWith: '@authtest.local' } } });
  await disconnectPrisma();
});

describe('POST /api/auth/login', () => {
  it('signs in, sets a cookie, and returns the user with a CSRF token', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: activeUser.email, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: activeUser.id, email: activeUser.email });
    expect(response.body.csrfToken).toBeTypeOf('string');
    expect(new Date(response.body.absoluteExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const cookie = (response.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('never puts the password hash in the response', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: activeUser.email, password: PASSWORD });

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('$argon2');
  });

  it('accepts the email case-insensitively', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: activeUser.email.toUpperCase(), password: PASSWORD });

    expect(response.status).toBe(200);
  });

  it('records the login on the user', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: activeUser.email, password: PASSWORD });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: activeUser.id },
      select: { lastLoginAt: true },
    });
    expect(user.lastLoginAt).not.toBeNull();
  });
});

/**
 * Task 3.4. Without regeneration, an attacker who can set a cookie in the
 * victim's browser — a subdomain, a shared machine, an XSS on any same-site
 * host — holds an ID that becomes authenticated the moment the victim signs in.
 */
describe('session fixation', () => {
  it('issues a new session ID on login and destroys the previous one', async () => {
    const agent = request.agent(app);

    const first = await agent
      .post('/api/auth/login')
      .send({ email: activeUser.email, password: PASSWORD });
    const firstSid = sidCookie(first.headers)!;
    expect(firstSid).toBeTruthy();
    expect(await sessionRow(firstSid)).not.toBeNull();

    // Logging in again over the same cookie: the ID the caller arrived with
    // must not be the ID they leave with.
    const second = await agent
      .post('/api/auth/login')
      .send({ email: activeUser.email, password: PASSWORD });
    const secondSid = sidCookie(second.headers)!;

    expect(secondSid).not.toBe(firstSid);
    expect(await sessionRow(firstSid)).toBeNull();
    expect(await sessionRow(secondSid)).not.toBeNull();
  });

  it('writes the user id only into the new session', async () => {
    const { agent } = await signIn(app, activeUser.email, PASSWORD);
    const me = await agent.get('/api/auth/me');

    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(activeUser.id);
  });
});

/**
 * The rule from the tech stack: one generic message, and a hash on every
 * attempt. The message is easy and everyone gets it right; the *cost* is the
 * part that leaks, and nothing about the response body reveals that it is
 * missing.
 */
describe('account enumeration', () => {
  const cases = [
    ['an unknown email', 'nobody@authtest.local', PASSWORD],
    ['a known email with the wrong password', 'active@authtest.local', 'wrong-password-entirely'],
    ['an account with no password set', 'invited@authtest.local', PASSWORD],
    ['a deactivated account', 'gone@authtest.local', PASSWORD],
  ] as const;

  beforeAll(async () => {
    await makeUser('invited@authtest.local', { password: null });
    await makeUser('gone@authtest.local', { isActive: false });
  });

  it.each(cases)('answers identically for %s', async (_label, email, password) => {
    const response = await request(app).post('/api/auth/login').send({ email, password });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(response.body.error.message).toBe(GENERIC_LOGIN_FAILURE);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  /**
   * The timing assertion. An implementation that returns early on an unknown
   * email answers in about a millisecond while a real verification takes tens
   * of them — a ratio near zero, and trivially measurable over a network. The
   * bound here is deliberately loose: it is sized to catch a missing hash, not
   * to certify constant time, which a JIT and a shared CI box cannot deliver
   * anyway.
   */
  it('spends comparable time on an unknown email as on a real one', async () => {
    async function medianMs(email: string): Promise<number> {
      const samples: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        // Each attempt fails, and four failures would trip the limiter into
        // answering 429 without hashing — which would make this measure the
        // wrong thing entirely.
        await clearLoginAttempts();
        const started = performance.now();
        await request(app).post('/api/auth/login').send({ email, password: 'wrong-password-here' });
        samples.push(performance.now() - started);
      }
      return samples.sort((a, b) => a - b)[2]!;
    }

    const known = await medianMs(activeUser.email);
    const unknown = await medianMs('definitely-not-a-user@authtest.local');

    expect(unknown).toBeGreaterThan(known * 0.5);
    expect(unknown).toBeLessThan(known * 2);
  });
});

/**
 * Task 3.8. Backoff rather than lockout: the real user gets in after a wait,
 * and an attacker gets a doubling one.
 */
describe('login rate limiting', () => {
  it('lets a few failures through, then throttles with a Retry-After', async () => {
    const email = 'throttle-me@authtest.local';

    for (let i = 0; i < 3; i += 1) {
      const response = await request(app).post('/api/auth/login').send({ email, password: 'nope' });
      expect(response.status).toBe(401);
    }

    const fourth = await request(app).post('/api/auth/login').send({ email, password: 'nope' });
    expect(fourth.status).toBe(401);

    const throttled = await request(app).post('/api/auth/login').send({ email, password: 'nope' });
    expect(throttled.status).toBe(429);
    expect(throttled.body.error.code).toBe('RATE_LIMITED');
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('backs off exponentially rather than locking out', async () => {
    const email = 'backoff@authtest.local';
    const ip = '::ffff:127.0.0.1';

    // Attempts are rows, so the curve can be measured by writing the history
    // rather than by waiting minutes for it to accumulate.
    const { checkLoginRateLimit } = await import('../../auth/login-rate-limit.js');
    const base = new Date();

    async function failuresOf(count: number): Promise<number> {
      await clearLoginAttempts();
      await prisma.loginAttempt.createMany({
        data: Array.from({ length: count }, () => ({
          emailKey: email,
          ipKey: ip,
          succeeded: false,
          occurredAt: base,
        })),
      });
      const decision = await checkLoginRateLimit({ email, ip }, base);
      return decision.retryAfterSeconds;
    }

    expect(await failuresOf(3)).toBe(0);
    const four = await failuresOf(4);
    const five = await failuresOf(5);
    const six = await failuresOf(6);

    expect(four).toBeGreaterThan(0);
    expect(five).toBeGreaterThan(four);
    expect(six).toBeGreaterThan(five);
    // A lockout would never let the caller back in; this is a wait, and a
    // bounded one.
    expect(await failuresOf(50)).toBeLessThanOrEqual(15 * 60);
  });

  /**
   * The asymmetry between the two buckets, asserted directly.
   *
   * A success clears the *account's* history — the real user got in, so the
   * failures before it were theirs. The IP's history is not cleared, or an
   * attacker holding one valid low-privilege account could wipe their host's
   * record of guessing at everyone else's by signing into their own between
   * bursts. Without this test, flipping that one boolean leaves the whole suite
   * green.
   */
  it('does not let a success on one account clear the IP’s record against another', async () => {
    const { checkLoginRateLimit } = await import('../../auth/login-rate-limit.js');
    const attackerHost = '::ffff:10.0.0.99';
    const at = new Date();

    await clearLoginAttempts();
    await prisma.loginAttempt.createMany({
      data: [
        // Five failures from this host, guessing at someone else's address…
        ...Array.from({ length: 5 }, () => ({
          emailKey: 'guessed@authtest.local',
          ipKey: attackerHost,
          succeeded: false,
          occurredAt: new Date(at.getTime() - 1_000),
        })),
        // …then a success against an account the attacker legitimately holds.
        {
          emailKey: 'attacker@authtest.local',
          ipKey: attackerHost,
          succeeded: true,
          occurredAt: at,
        },
      ],
    });

    /**
     * Asked about a *third* address, one with no history of its own. The
     * account bucket is empty for it, so the only thing that can answer
     * "blocked" is the IP bucket — which is the point. Probing with the guessed
     * address instead would prove nothing: its own account bucket would block
     * it either way, and the assertion would pass with the IP bucket broken.
     */
    const fromAttackerHost = await checkLoginRateLimit(
      { email: 'never-tried@authtest.local', ip: attackerHost },
      at,
    );
    expect(fromAttackerHost.allowed).toBe(false);
  });

  /**
   * The other half of the same rule, isolated the same way: an account whose
   * failures are followed by a success, asked from a host with no history, so
   * only the account bucket can answer.
   */
  it('does let a success clear the account’s own record', async () => {
    const { checkLoginRateLimit } = await import('../../auth/login-rate-limit.js');
    const email = 'forgiven@authtest.local';
    const at = new Date();

    await clearLoginAttempts();
    await prisma.loginAttempt.createMany({
      data: [
        ...Array.from({ length: 5 }, (_unused, index) => ({
          emailKey: email,
          ipKey: `::ffff:10.0.1.${index}`,
          succeeded: false,
          occurredAt: new Date(at.getTime() - 1_000),
        })),
        { emailKey: email, ipKey: '::ffff:10.0.1.200', succeeded: true, occurredAt: at },
      ],
    });

    const decision = await checkLoginRateLimit({ email, ip: '::ffff:10.0.2.1' }, at);
    expect(decision.allowed).toBe(true);
  });

  it('throttles a wrong password even when the account exists', async () => {
    // Otherwise the limiter itself is the oracle: throttled means real.
    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: activeUser.email, password: 'still-wrong' });
    }

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: activeUser.email, password: 'still-wrong' });

    expect(response.status).toBe(429);
  });

  it('clears the account bucket on a successful sign-in', async () => {
    const email = secondUser.email;

    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/api/auth/login').send({ email, password: 'wrong' });
    }

    const ok = await request(app).post('/api/auth/login').send({ email, password: OTHER_PASSWORD });
    expect(ok.status).toBe(200);

    // The successful login wiped the account's failures, so the next mistake
    // starts from zero rather than from a wait the real user already cleared.
    const after = await request(app).post('/api/auth/login').send({ email, password: 'wrong' });
    expect(after.status).toBe(401);
  });
});

/**
 * Task 3.6, and the reason it is a requirement rather than a nicety: the PRD
 * deactivates departed users instead of deleting them, and a session that
 * outlives the account makes that cosmetic.
 */
describe('revocation', () => {
  it('kills a live session the moment the account is deactivated', async () => {
    const user = await makeUser('leaver@authtest.local');
    const { agent } = await signIn(app, user.email, PASSWORD);

    expect((await agent.get('/api/auth/me')).status).toBe(200);

    // What task 4.3's admin endpoint will do, from the same functions.
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false, deactivatedAt: new Date() },
    });
    const revoked = await revokeSessionsForUser(user.id);

    expect(revoked).toBe(1);
    const after = await agent.get('/api/auth/me');
    expect(after.status).toBe(401);
    expect(await listSessionsForUser(user.id)).toHaveLength(0);
  });

  it('rejects a session whose user was deactivated but whose row survived', async () => {
    // Belt and braces: revocation deletes the rows, but the per-request lookup
    // means a row that escapes deletion still stops working.
    const user = await makeUser('straggler@authtest.local');
    const { agent } = await signIn(app, user.email, PASSWORD);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const after = await agent.get('/api/auth/me');
    expect(after.status).toBe(401);
    // …and the request that found the dead account cleaned up after itself.
    expect(await listSessionsForUser(user.id)).toHaveLength(0);
  });

  it('lists a user’s sessions and can sign out everywhere but here', async () => {
    const user = await makeUser('multi@authtest.local');
    const laptop = await signIn(app, user.email, PASSWORD);
    const phone = await signIn(app, user.email, PASSWORD);

    expect(await listSessionsForUser(user.id)).toHaveLength(2);

    const listed = await phone.agent.get('/api/auth/sessions');
    expect(listed.body.items).toHaveLength(2);
    expect(listed.body.items.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const revoked = await phone.agent
      .post('/api/auth/logout-others')
      .set(CSRF_HEADER, phone.csrfToken);

    expect(revoked.body.revoked).toBe(1);
    expect((await phone.agent.get('/api/auth/me')).status).toBe(200);
    expect((await laptop.agent.get('/api/auth/me')).status).toBe(401);
  });

  it('stamps the session row with its owner, which is what makes any of this queryable', async () => {
    const user = await makeUser('stamped@authtest.local');
    await signIn(app, user.email, PASSWORD);

    const rows = await prisma.session.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });
});

/** Task 3.5. Rolling renewal must not turn into an unbounded session. */
describe('session lifetime', () => {
  it('extends the idle window on every request', async () => {
    const user = await makeUser('rolling@authtest.local');
    const { agent } = await signIn(app, user.email, PASSWORD);

    const before = (await prisma.session.findFirstOrThrow({ where: { userId: user.id } })).expire;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await agent.get('/api/auth/me');
    const after = (await prisma.session.findFirstOrThrow({ where: { userId: user.id } })).expire;

    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it('ends the session at the absolute lifetime however active it has been', async () => {
    const user = await makeUser('expired@authtest.local');
    const { agent } = await signIn(app, user.email, PASSWORD);

    // Backdate the stamp rather than waiting twelve hours. The cookie is still
    // valid and the row is still live — only the hard ceiling has passed.
    const row = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    const sess = row.sess as Record<string, unknown>;
    await prisma.session.update({
      where: { sid: row.sid },
      data: { sess: { ...sess, absoluteExpiresAt: Date.now() - 1_000 } },
    });

    const response = await agent.get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(await sessionRow(row.sid)).toBeNull();
  });
});

describe('POST /api/auth/logout', () => {
  it('destroys the session row and the cookie stops working', async () => {
    const user = await makeUser('logout@authtest.local');
    const { agent, csrfToken } = await signIn(app, user.email, PASSWORD);
    const row = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });

    const response = await agent.post('/api/auth/logout').set(CSRF_HEADER, csrfToken);

    expect(response.status).toBe(204);
    expect(await sessionRow(row.sid)).toBeNull();
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('401s without a session rather than pretending to have logged someone out', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(401);
  });

  it('requires the CSRF token', async () => {
    const user = await makeUser('csrf-logout@authtest.local');
    const { agent } = await signIn(app, user.email, PASSWORD);

    expect((await agent.post('/api/auth/logout')).status).toBe(403);
    // Still signed in — the rejected request changed nothing.
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('rejects a token belonging to a different session', async () => {
    const mine = await signIn(app, activeUser.email, PASSWORD);
    const theirs = await signIn(app, secondUser.email, OTHER_PASSWORD);

    const response = await mine.agent.post('/api/auth/logout').set(CSRF_HEADER, theirs.csrfToken);

    expect(response.status).toBe(403);
  });
});

describe('GET /api/auth/me', () => {
  it('reflects a role change without waiting for the cookie to expire', async () => {
    const { agent } = await signIn(app, adminUser.email, PASSWORD);
    expect((await agent.get('/api/auth/me')).body.user.role).toBe('ADMIN');

    await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'AGENT' } });

    expect((await agent.get('/api/auth/me')).body.user.role).toBe('AGENT');
    await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'ADMIN' } });
  });

  it('surfaces mustChangePassword so the UI can act on it', async () => {
    const user = await makeUser('forced@authtest.local');
    await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });

    const { agent } = await signIn(app, user.email, PASSWORD);

    expect((await agent.get('/api/auth/me')).body.user.mustChangePassword).toBe(true);
  });
});
