-- One-time local setup against a Postgres you already have running:
--
--   psql postgres -f apps/server/scripts/create-databases.sql
--
-- Creates the role and both databases the default DATABASE_URL and
-- TEST_DATABASE_URL point at. The test database is separate and explicit
-- because `pnpm test` truncates every table between files — it must never be
-- pointed at the seeded dev data.

CREATE ROLE support WITH LOGIN PASSWORD 'support' CREATEDB;
CREATE DATABASE helpdesk OWNER support;
CREATE DATABASE helpdesk_test OWNER support;
