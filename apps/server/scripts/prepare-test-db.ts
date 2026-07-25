/**
 * Brings the test database up to the current migration before Vitest runs.
 * Kept separate from `migrate.ts` so that the production migration task can
 * never be pointed at a test database by accident.
 */
import { spawnSync } from 'node:child_process';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://support:support@localhost:5432/helpdesk_test';

if (!/test/i.test(url)) {
  console.error(`Refusing to prepare a test database whose URL does not look like one: ${url}`);
  process.exit(1);
}

const result = spawnSync('prisma', ['migrate', 'deploy'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, DATABASE_URL: url },
  shell: false,
});

if (result.status !== 0) {
  console.error('Failed to migrate the test database. Is Postgres running?');
  process.exit(result.status ?? 1);
}
