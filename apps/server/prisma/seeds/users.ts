import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/auth/password.js';
import { SEED_AGENT_PASSWORD } from '../../src/config/seed-credentials.js';
import { AGENT_ALEX, AGENT_MARIA, AGENT_SAM } from './ticket-fixtures.js';

/** Kept in step with `PLACEHOLDER_SECRETS` in `src/config/env.ts`. */
const PLACEHOLDER_PASSWORDS = new Set(['change-me-immediately']);

/**
 * There is no self-service signup, so the first admin has to be seeded — a
 * fresh database otherwise locks you out of your own system. Credentials come
 * from the environment, never from a literal here.
 */
export async function seedBootstrapAdmin(prisma: PrismaClient): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME ?? 'Bootstrap Admin';

  if (!email || !password) {
    throw new Error(
      'BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set to seed the bootstrap admin.',
    );
  }
  if (password.length < 12) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');
  }
  // Checked here as well as in the env schema, because the seed reads
  // `process.env` directly and does not go through it. A placeholder long
  // enough to clear the length check would otherwise create a live ADMIN
  // account whose password is published in this repository — and from Phase 3
  // there is a login route to use it against.
  if (PLACEHOLDER_PASSWORDS.has(password)) {
    throw new Error(
      'BOOTSTRAP_ADMIN_PASSWORD is still the .env.example placeholder. Choose a real password.',
    );
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    // Never silently reset a live admin's password on a re-run.
    console.log(`  admin ${email} already exists — left unchanged`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name,
      role: 'ADMIN',
      passwordHash: await hashPassword(password),
      // The bootstrap credential sits in plaintext in `.env`; it is a way in,
      // not a password anyone should keep using.
      mustChangePassword: true,
    },
  });

  console.log(`  created admin ${email} (must change password on first login)`);
}

/**
 * Dev-only password for seeded agents. Defined in `src/config/` and re-exported
 * here so existing callers keep working — `src/` cannot import from `prisma/`
 * without breaking `pnpm build`, which compiles `src/` alone.
 */
export { SEED_AGENT_PASSWORD };

const AGENTS = [
  { email: AGENT_ALEX, name: 'Alex Chen', role: 'AGENT' as const },
  { email: AGENT_MARIA, name: 'Maria Okonkwo', role: 'AGENT' as const },
  { email: AGENT_SAM, name: 'Sam Delacroix', role: 'ADMIN' as const },
];

/**
 * User management does not ship until Phase 4, so without these, ticket
 * assignment and author attribution have nothing to point at — they would look
 * correct against a single admin account and prove nothing.
 */
export async function seedAgents(prisma: PrismaClient): Promise<void> {
  const passwordHash = await hashPassword(SEED_AGENT_PASSWORD);

  for (const agent of AGENTS) {
    await prisma.user.upsert({
      where: { email: agent.email },
      create: { ...agent, passwordHash, mustChangePassword: false },
      update: { name: agent.name, role: agent.role, isActive: true },
    });
  }

  console.log(`  seeded ${AGENTS.length} agent accounts (password: ${SEED_AGENT_PASSWORD})`);
}
