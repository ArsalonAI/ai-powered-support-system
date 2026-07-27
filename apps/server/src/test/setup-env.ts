/**
 * Runs before any test module is imported, so `src/config/env.ts` sees a valid
 * environment. Tests must never run against the dev database — TEST_DATABASE_URL
 * wins, and the fallback points at `helpdesk_test`.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
// Fixed, so a test run never depends on the developer's .env. Sessions issued
// under it live only as long as the test database rows do.
process.env.SESSION_SECRET = 'test-session-secret-not-used-outside-vitest-runs';
// The suite must not reach out to HIBP: it would be slow, flaky, and would make
// the policy tests depend on someone else's uptime.
process.env.PASSWORD_BREACH_CHECK = 'off';
// Fixed rather than inherited from the developer's .env, so the dev-dashboard
// test can assert that this password never reaches the page. Reading the real
// one would make that assertion depend on whatever happens to be configured.
process.env.BOOTSTRAP_ADMIN_EMAIL = 'bootstrap-admin@test.local';
process.env.BOOTSTRAP_ADMIN_PASSWORD = 'test-bootstrap-password-never-rendered';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://support:support@localhost:5432/helpdesk_test';
