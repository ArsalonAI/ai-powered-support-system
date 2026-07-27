# AI-Powered Support System

An email support CRM that drafts replies with Claude, grounded in a knowledge
base. Customer email becomes a ticket; the system classifies it, summarizes the
thread, and proposes a reply citing its sources. **A human reviews and sends
every message** — the AI never emails a customer on its own.

Built for a small in-house support team (1–3 agents, under 50 tickets/day).

**It runs locally.** Two Node processes and a Postgres on your machine — no
containers, no cloud account, no CI. The only things it talks to over the
network are the Gmail API and the Anthropic API.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/prd.md](docs/prd.md) | Problem, users and roles, knowledge base, ticket lifecycle, success metrics, non-functional requirements, out of scope |
| [docs/tech-stack.md](docs/tech-stack.md) | Stack decisions and their rationale — React/Express/Postgres/Prisma, session auth, Gmail polling, Claude, OpenTelemetry |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Eight build phases with tasks, sizing, critical path, and risks |

## Status

**Phases 1 and 2 complete. [Phase 3 — Authentication](docs/implementation-plan.md#phase-3--authentication)
is in progress** — sessions, login, and route protection have landed. Sign in
with a seeded account, work the queue, and every reply and audit entry is
attributed to the account that made it.

Run `pnpm dev:worker` in a second terminal for the worker's housekeeping. It
must stay at exactly one process. It does **not** touch ticket status — the
timed auto-resolve and auto-close sweeps were cut, so nothing moves a ticket
without a person.

**The API is no longer open.** Every route except `/api/health` requires a
session; the acting-user seam that stood in for one during Phase 2 has been
deleted, not left behind a flag. `grep -rn "acting-user" apps` returns nothing,
which is the check task 3.13 asks for.

What that brought with it:

- **argon2id password hashing**, and a policy of 12 characters minimum with
  `zxcvbn` scoring and an HIBP k-anonymity breach check. No composition rules.
- **Sessions in Postgres** via `express-session` + `connect-pg-simple`, with a
  rolling idle timeout and a hard absolute lifetime that activity never
  extends. The session ID is regenerated on login.
- **Sessions are queryable and deletable by user ID**, which is what will make
  Phase 4's deactivation immediate rather than cosmetic.
- **Login throttling per account *and* per IP**, backing off exponentially
  rather than locking out — a lockout hands an attacker a denial of service
  against the whole team.
- **CSRF tokens** on every state-changing request, and a global 401 handler in
  the SPA that returns to the login page when a session ends mid-use.

Sign in with any seeded agent — `alex.chen@example.com` / `dev-password-change-me`
(see `apps/server/prisma/seeds/users.ts`) — or with the bootstrap admin from
your `.env`.

`.env.example` ships `SESSION_SECRET` and `BOOTSTRAP_ADMIN_PASSWORD` **blank**,
and both the env schema and the seed reject the placeholders they used to carry.
A placeholder that is long enough to pass validation is worse than a missing
one: it boots, and the instruction to replace it reads as already done. Since
Phase 3 the bootstrap admin is a real login on a server that binds every
interface, and `mustChangePassword` is only a banner until task 4.7.

Items deliberately only half-landed, because their other half belongs to a later
phase:

- **Forced password change (1.15)** is surfaced as a banner but not enforced.
  Enforcing it needs somewhere to change the password, which is task 4.7.
- **`requireAdmin` exists and nothing uses it yet** — Phase 4 is the first
  admin-only surface. It shipped now because task 4.2 asks that authorization
  be an audit of existing routes rather than a second retrofit.
- **Ticket, user, and stats read endpoints** landed ahead of their phases so the
  seeded corpus is explorable. They cover parts of 7.1/7.2/7.4; the dashboard UI
  is outstanding.

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/server` | Express + TypeScript API, Prisma schema and migrations, seeds |
| `apps/client` | Vite + React SPA, TanStack Query, Tailwind |
| `packages/shared` | Domain enums and API contract types shared by both |

## Getting started

Requires Node 22+, pnpm, and a running Postgres 17 (`brew install
postgresql@17 && brew services start postgresql@17`, or any equivalent).

```bash
psql postgres -f apps/server/scripts/create-databases.sql  # once: role + both databases
pnpm install
cp apps/server/.env.example apps/server/.env               # ships with SESSION_SECRET and the admin password blank
openssl rand -base64 48                                    # → SESSION_SECRET; the API exits at boot without one
pnpm db:migrate                                            # apply migrations
pnpm db:seed                                               # bootstrap admin, agents, ticket fixtures
pnpm dev                                                   # server on :3000, client on :5173
```

The SPA proxies `/api/*` to the API, so the browser only ever sees one origin —
that is what keeps session cookies `SameSite=Lax` with no CORS. Do not replace
it with an absolute API URL.

## The developer dashboard

With `pnpm dev` running and a session in the browser,
**http://localhost:5173/api/dev** is the page to start from when driving the app
by hand:

- every account you can sign in as, with the seeded agents' password
- test coverage per package, linking through to the full line-by-line reports
- links to Swagger UI, the OpenAPI document, health, and the app itself

It is **development-only and behind the session**, both deliberately. It prints
working credentials, so `assertDevDashboardAllowed()` fails the boot when
`NODE_ENV=production` — the same pattern the storage driver uses, where someone
has to delete the code rather than remember a flag. And a page listing passwords
is the last thing that should be the exception to "every route needs a session",
so the first credential comes from this README, not from the page.

The bootstrap admin is listed but its password is not: that one is chosen by a
person in `.env` and may be reused elsewhere, unlike the seeded agents' shared
literal that `pnpm db:seed` already prints.

## Exploring the API

With `pnpm dev` running, **http://localhost:5173/api/docs** serves Swagger UI
over the seeded data — read endpoints for the ticket queue, ticket detail,
users, and aggregate stats. The OpenAPI document is generated from the same Zod
schemas the server validates against, so it cannot drift from the code.

It is **disabled in production** (`ENABLE_API_DOCS`) and, from Phase 3, **needs
a session like everything else** — sign in through the SPA first and the same
browser session opens the docs. The document holds no customer data, but it is a
complete index of every route and its shape, which is not something an
unauthenticated caller needs to be able to read.

| Command | Does |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm test` / `pnpm build` | The verification sequence — run it before committing |
| `pnpm test:coverage` | Same tests, plus a coverage report per package |
| `pnpm coverage:open` | Opens the three HTML reports, line by line |
| — | Or read them in the app: **`/api/dev`** shows the same figures and links through |
| `pnpm db:reset` | Drop, re-migrate, and re-seed |
| `pnpm db:studio` | Prisma Studio over the dev database |

### Reading the coverage numbers

Each package reports separately (`apps/server/coverage/`, `apps/client/coverage/`,
`packages/shared/coverage/`), and the three are not comparable:

- **`apps/server`** is the number that means what it looks like. The domain logic
  and every route are exercised against a real Postgres.
- **`apps/client`** counts a component as covered only where a test renders it.
- **`packages/shared`** reads low by construction and is close to meaningless on
  its own. It is mostly Zod schemas and enum objects, exercised constantly by
  both apps' tests but rarely imported by a test *in this package*. It measures
  how much of the contract this package pins down itself, not how much works.

Coverage is reported, not enforced — there is no threshold that fails a run. A
percentage gate tends to buy assertion-free tests that execute lines; the tests
worth having here are the ones asserting the failure modes, which the
[implementation plan](docs/implementation-plan.md) calls out per phase.

## License

TBD
