# AI-Powered Support System

An email support CRM that drafts replies with Claude, grounded in a knowledge
base. Customer email becomes a ticket; the system classifies it, summarizes the
thread, and proposes a reply citing its sources. **A human reviews and sends
every message** — the AI never emails a customer on its own.

Built for a small in-house support team (1–3 agents, under 50 tickets/day).

## Documentation

| Document | Contents |
| --- | --- |
| [docs/prd.md](docs/prd.md) | Problem, users and roles, knowledge base, ticket lifecycle, success metrics, non-functional requirements, out of scope |
| [docs/tech-stack.md](docs/tech-stack.md) | Stack decisions and their rationale — React/Express/Postgres/Prisma, session auth, Gmail polling, Claude, OpenTelemetry, Docker on AWS |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Eight build phases with tasks, sizing, critical path, and risks |

## Status

**Phase 1 complete** — scaffolding, schema, and seed data. The app boots, the
full schema is migrated, and a realistic ticket corpus is seeded. Next is
[Phase 2 — Authentication](docs/implementation-plan.md#phase-2--authentication);
until it lands there is no login and no route protection.

Two Phase 1 items are deliberately only half-landed, because their other half
belongs to a later phase:

- **Forced password change (1.15)** exists as the `mustChangePassword` column
  and is set by the bootstrap seed. Nothing enforces it until Phase 2 builds
  the login flow.
- **argon2id hashing (2.1)** shipped early, because the bootstrap admin seed
  cannot hash a password without it.

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/server` | Express + TypeScript API, Prisma schema and migrations, seeds |
| `apps/client` | Vite + React SPA, TanStack Query, Tailwind |
| `packages/shared` | Domain enums and API contract types shared by both |

## Getting started

Requires Node 22+, pnpm, and Postgres 17 (via `docker compose up -d postgres`,
or a local install exposing the same URL).

```bash
pnpm install
cp apps/server/.env.example apps/server/.env  # edit the bootstrap admin credentials
pnpm db:migrate                               # apply migrations
pnpm db:seed                                  # bootstrap admin, agents, ticket fixtures
pnpm dev                                      # server on :3000, client on :5173
```

The SPA proxies `/api/*` to the API in development, mirroring the production
topology where CloudFront serves both from one origin — that is what keeps
session cookies `SameSite=Lax` with no CORS.

## Exploring the API

With `pnpm dev` running, **http://localhost:5173/api/docs** serves Swagger UI
over the seeded data — read endpoints for the ticket queue, ticket detail,
users, and aggregate stats. The OpenAPI document is generated from the same Zod
schemas the server validates against, so it cannot drift from the code.

It is **disabled in production** (`ENABLE_API_DOCS`), and these endpoints are
unauthenticated only because Phase 2 has not shipped; they move behind
`requireAuth` when it does.

| Command | Does |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` | What CI runs, in that order |
| `pnpm db:migrate:deploy` | The one-off migration task; what deploys run |
| `pnpm db:reset` | Drop, re-migrate, and re-seed |

## License

TBD
