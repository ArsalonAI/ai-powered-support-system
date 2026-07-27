import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Same .env the dev server and the Prisma CLI read (cwd is apps/server).
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
    coverage: {
      provider: 'v8',
      // `text` for the terminal, `html` to click through line by line, `lcov`
      // so an editor gutter or any external tool can read the same run.
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      /**
       * `all: true` is the setting that makes the number honest. Without it,
       * only files some test imported are counted — so deleting the last test
       * for a module *raises* the reported percentage, and a file nothing
       * touches is invisible rather than 0%.
       */
      all: true,
      include: ['src/**/*.ts', 'prisma/seeds/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        // Test scaffolding, not code under test.
        'src/test/**',
        // Process entry points. They bind a port, register signal handlers, and
        // start timers; a unit test of them would assert nothing a running app
        // does not already prove.
        'src/server.ts',
        'src/worker.ts',
        // Generated or declarative: the OpenAPI registry is a data structure,
        // and its correctness is asserted through the document it produces.
        'src/http/openapi/**',
      ],
    },
  },
});
