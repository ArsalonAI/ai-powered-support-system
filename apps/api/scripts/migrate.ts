/**
 * Migrations run as a one-off task before the services deploy, never on
 * container start — concurrent tasks would race each other.
 *
 * Locally: `pnpm db:migrate:deploy`.
 * Deployed: the same command as the ECS task's `command`, ahead of the rolling
 * update in the CD pipeline (8.9).
 */
import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set; refusing to run migrations.');
  process.exit(1);
}

// Log the host, never the credentials.
const host = (() => {
  try {
    return new URL(databaseUrl).host;
  } catch {
    return 'unparseable';
  }
})();

console.log(`Applying migrations to ${host}…`);

const result = spawnSync('prisma', ['migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

if (result.error) {
  console.error(`Failed to run prisma migrate deploy: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`prisma migrate deploy exited with code ${result.status ?? 'unknown'}`);
  process.exit(result.status ?? 1);
}

console.log('Migrations applied.');
