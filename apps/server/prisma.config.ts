import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

/**
 * Replaces the deprecated `package.json#prisma` block, which Prisma 7 removes.
 *
 * The `.env` load is load-bearing: once a config file exists, Prisma stops
 * loading `.env` automatically. Without this, `DATABASE_URL` is undefined and
 * every CLI command fails — migrate, seed, studio, and the test-database setup
 * alike. Node's built-in loader is used rather than dotenv so this stays a
 * dependency-free file.
 *
 * `loadEnvFile` does not overwrite variables already present in the
 * environment, which is what keeps `scripts/prepare-test-db.ts` pointed at the
 * test database: it passes DATABASE_URL explicitly, and that wins over the
 * dev value in `.env`. If that ever changes, `pnpm test` would migrate the
 * development database instead — silently.
 */
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
