/**
 * Seeds the database. Two tiers, deliberately separated:
 *
 *   - The bootstrap admin runs everywhere, production included. Without it the
 *     first deploy has no way in.
 *   - Agent accounts and ticket fixtures are development data and refuse to
 *     run against NODE_ENV=production.
 */
import { PrismaClient } from '@prisma/client';
import { seedAgents, seedBootstrapAdmin } from './seeds/users.js';
import { seedTickets } from './seeds/tickets.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';

  console.log('Seeding bootstrap admin…');
  await seedBootstrapAdmin(prisma);

  if (isProduction) {
    console.log('NODE_ENV=production — skipping agent accounts and ticket fixtures.');
    return;
  }

  console.log('Seeding agent accounts…');
  await seedAgents(prisma);

  console.log('Seeding ticket fixtures…');
  await seedTickets(prisma);

  console.log('Done.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
