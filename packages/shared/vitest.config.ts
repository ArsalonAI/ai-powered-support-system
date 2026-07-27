import { defineConfig } from 'vitest/config';

/**
 * `packages/shared` had no config: `vitest run` on the defaults was enough for
 * one test file. Coverage needs somewhere to say what counts as source, and
 * here that matters more than the number — most of this package is Zod schemas
 * and enum objects, which a consumer's test exercises without ever importing
 * the file directly. Read the percentage accordingly: it says how much of the
 * contract *this package's own* tests pin down, not how much of it works.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      all: true,
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/index.ts'],
    },
  },
});
