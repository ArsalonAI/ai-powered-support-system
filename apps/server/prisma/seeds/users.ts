import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/auth/password.js';
import { AGENT_ALEX, AGENT_MARIA, AGENT_SAM } from './ticket-fixtures.js';

/**
 * There is no self-service signup, so the first admin has to be seeded — the
 * first deploy otherwise locks you out of your own system. Credentials come
 * from the environment (Secrets Manager in AWS), never from a literal here.
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
      // The bootstrap credential is shared and lives in a secrets store; it is
      // a way in, not a password anyone should keep using.
      mustChangePassword: true,
    },
  });

  console.log(`  created admin ${email} (must change password on first login)`);
}

/** Dev-only password for seeded agents. Never used outside development seeds. */
export const SEED_AGENT_PASSWORD = 'dev-password-change-me';

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
