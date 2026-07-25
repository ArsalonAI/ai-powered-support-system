-- Runs once on first container start. The dev database comes from
-- POSTGRES_DB; the test database has to be created explicitly so `pnpm test`
-- never touches seeded dev data.
CREATE DATABASE helpdesk_test OWNER support;
