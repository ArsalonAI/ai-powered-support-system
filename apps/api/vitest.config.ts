import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Same .env the dev server and the Prisma CLI read (cwd is apps/api).
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'prisma/**/*.test.ts'],
    setupFiles: ['./src/test/setup-env.ts'],
    // Integration tests share one Postgres database; running files in parallel
    // would have them truncating each other's rows mid-assertion.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
