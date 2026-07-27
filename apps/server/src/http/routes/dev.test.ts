import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED_AGENT_PASSWORD, seedAgents } from '../../../prisma/seeds/users.js';
import { createApp } from '../../app.js';
import { hashPassword } from '../../auth/password.js';
import { env } from '../../config/env.js';
import { assertDevDashboardAllowed } from './dev.js';
import { disconnectPrisma, prisma } from '../../db/prisma.js';
import {
  clearLoginAttempts,
  clearSessions,
  signIn,
  type SignedInAgent,
} from '../../test/session.js';

/**
 * The developer dashboard serves working credentials, which makes two things
 * worth asserting rather than assuming: that it is behind the session like
 * everything else, and that it refuses to exist in production.
 */

const app = createApp();

let api: SignedInAgent;
let agentEmail: string;

beforeAll(async () => {
  await seedAgents(prisma);
  const [agent] = await prisma.user.findMany({ orderBy: { name: 'asc' }, select: { email: true } });
  agentEmail = agent!.email;

  await clearLoginAttempts();
  api = (await signIn(app, agentEmail)).agent;
}, 60_000);

afterAll(async () => {
  await clearSessions();
  await clearLoginAttempts();
  // Files share one database and run in sequence, so this row would otherwise
  // outlive the file. It sorts between the seeded agents by name, and the next
  // file to pick "the second user by name" and sign in as them would get an
  // account with a different password and a failure pointing nowhere near here.
  await prisma.user.deleteMany({ where: { email: env.BOOTSTRAP_ADMIN_EMAIL } });
  await disconnectPrisma();
});

describe('GET /api/dev', () => {
  it('lists the accounts you can sign in as, with their passwords', async () => {
    const response = await api.get('/api/dev');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain(agentEmail);
    expect(response.text).toContain(SEED_AGENT_PASSWORD);
  });

  it('never prints the bootstrap admin password, which is a real credential', async () => {
    // The seeded agents share a literal that `pnpm db:seed` already echoes, so
    // printing it costs nothing. The bootstrap admin's comes from `.env`, is
    // chosen by a person, and is the one they might have reused elsewhere.
    const bootstrapEmail = env.BOOTSTRAP_ADMIN_EMAIL!;
    const bootstrapPassword = env.BOOTSTRAP_ADMIN_PASSWORD!;
    expect(bootstrapEmail, 'setup-env.ts pins these').toBeTruthy();
    expect(bootstrapPassword).toBeTruthy();

    await prisma.user.upsert({
      where: { email: bootstrapEmail },
      create: {
        email: bootstrapEmail,
        name: 'Bootstrap Admin',
        role: 'ADMIN',
        passwordHash: await hashPassword(bootstrapPassword),
      },
      update: {},
    });

    const response = await api.get('/api/dev');

    // The account is listed — you need to know it exists…
    expect(response.text).toContain(bootstrapEmail);
    // …and pointed at .env instead of having its password spelled out.
    expect(response.text).toContain('BOOTSTRAP_ADMIN_PASSWORD');
    expect(response.text).not.toContain(bootstrapPassword);
  });

  it('reports coverage as missing rather than failing when it has not been generated', async () => {
    // A fresh clone has no coverage/ directory. The page still has to render.
    const response = await api.get('/api/dev');

    expect(response.status).toBe(200);
    expect(response.text).toMatch(/apps\/server|Not generated/);
  });

  // The point of the whole exercise: a page of passwords must not be the one
  // route that sits outside the session check.
  it('401s without a session', async () => {
    const response = await request(app).get('/api/dev');

    expect(response.status).toBe(401);
    expect(response.text).not.toContain(SEED_AGENT_PASSWORD);
  });

  it('401s on the coverage reports too', async () => {
    const response = await request(app).get('/api/dev/coverage/server/');

    expect(response.status).toBe(401);
  });
});

describe('production guard', () => {
  it('permits the dashboard outside production', () => {
    expect(() => assertDevDashboardAllowed()).not.toThrow();
  });

  /**
   * `isProduction` is resolved once when `config/env.ts` is first imported, so
   * flipping `process.env` at runtime proves nothing — the already-loaded module
   * would keep its old answer and the assertion would pass against a guard that
   * does not work. The module graph has to be rebuilt under the new environment.
   */
  it('refuses to start when NODE_ENV=production', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');

    try {
      const { assertDevDashboardAllowed: guard } = await import('./dev.js');
      expect(() => guard()).toThrow(/never run in production/i);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
