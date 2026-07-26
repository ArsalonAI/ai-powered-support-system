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

**Phase 1 complete** — scaffolding, schema, and seed data. The app boots, the
full schema is migrated, and a realistic ticket corpus is seeded. Next is
[Phase 2 — Ticket CRUD](docs/implementation-plan.md#phase-2--ticket-crud).

**There is no login, and there will not be until Phase 3.** Authentication sits
*after* ticket work on purpose: the queue is the product, and building it behind
a login that does not exist yet means building it blind. So the app is open, and
during Phase 2 it is writable by anyone who can reach it. Run it on localhost.

Attribution is not relaxed by that — the database rejects an outbound message
with no author and an audit entry with no actor. Task 2.1 supplies a temporary
`getActingUser(req)` seam that resolves to a real seeded agent, and task 3.13
deletes it once sessions exist.

Items deliberately only half-landed, because their other half belongs to a later
phase:

- **Forced password change (1.15)** exists as the `mustChangePassword` column
  and is set by the bootstrap seed. Nothing enforces it until Phase 3 builds
  the login flow.
- **argon2id hashing (3.1)** shipped early, because the bootstrap admin seed
  cannot hash a password without it.
- **Ticket, user, and stats read endpoints** landed ahead of their phases so the
  seeded corpus is explorable. They cover the server side of 2.11–2.14 and parts
  of 7.1/7.2/7.4; the UI for all of it is outstanding.

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
cp apps/server/.env.example apps/server/.env               # edit the bootstrap admin credentials
pnpm db:migrate                                            # apply migrations
pnpm db:seed                                               # bootstrap admin, agents, ticket fixtures
pnpm dev                                                   # server on :3000, client on :5173
```

The SPA proxies `/api/*` to the API, so the browser only ever sees one origin —
that is what keeps session cookies `SameSite=Lax` with no CORS. Do not replace
it with an absolute API URL.

## Exploring the API

With `pnpm dev` running, **http://localhost:5173/api/docs** serves Swagger UI
over the seeded data — read endpoints for the ticket queue, ticket detail,
users, and aggregate stats. The OpenAPI document is generated from the same Zod
schemas the server validates against, so it cannot drift from the code.

It is **disabled in production** (`ENABLE_API_DOCS`), and these endpoints are
unauthenticated only because Phase 3 has not shipped; they move behind
`requireAuth` when it does.

| Command | Does |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm test` / `pnpm build` | The verification sequence — run it before committing |
| `pnpm db:reset` | Drop, re-migrate, and re-seed |
| `pnpm db:studio` | Prisma Studio over the dev database |

## License

TBD
