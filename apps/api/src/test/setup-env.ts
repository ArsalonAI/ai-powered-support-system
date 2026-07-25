/**
 * Runs before any test module is imported, so `src/config/env.ts` sees a valid
 * environment. Tests must never run against the dev database — TEST_DATABASE_URL
 * wins, and the fallback points at `support_test`.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://support:support@localhost:5432/support_test';
