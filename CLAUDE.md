# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An email support CRM for a small in-house team (1–3 agents, under 50 tickets/day).
Customer email becomes a ticket; Claude classifies it, summarizes the thread, and
drafts a reply citing knowledge base sources. **A human reviews and sends every
message** — the AI has no send path.

## The specs are the source of truth

Three documents in `docs/` are the specification, not background reading. Code
that contradicts them is a defect even when it is internally consistent:

| Document | Governs |
| --- | --- |
| `docs/prd.md` | Roles, ticket lifecycle, grounding rule, success metrics |
| `docs/tech-stack.md` | Stack choices *and their rationale* — read the rationale before proposing an alternative |
| `docs/implementation-plan.md` | Task-level build order, numbered `1.1`–`8.17` |

**The build is phase-driven and strictly sequential.** `README.md`'s Status
section names the current phase. Work the numbered tasks of that phase; do not
build ahead into a later one. Conversely, do not report a later phase's absence
as a bug — Phase 1 has no login by design.

Several decisions look like over-engineering until you read why: the plain
`Job` table instead of a job library, the knowledge base in a cached prompt
instead of a vector store, the single worker task. Each has a documented
threshold for revisiting. Check it before changing course.

## Commands

Postgres comes from `docker compose up -d postgres` (or any local install
exposing the same URL). First run:

```bash
pnpm install                             # builds packages/shared via its prepare script
cp apps/api/.env.example apps/api/.env   # then edit the bootstrap admin credentials
pnpm db:migrate && pnpm db:seed
pnpm dev                                 # API :3000, SPA :5173
```

| Command | Notes |
| --- | --- |
| `pnpm typecheck` \| `lint` \| `format:check` \| `test` \| `build` | Exactly what CI runs, in that order |
| `pnpm --filter @support/api test` | Migrates the test database first, then runs Vitest |
| `pnpm --filter @support/api exec vitest run src/auth/password.test.ts` | One file — skips the test-DB migration, so run the line above at least once first |
| `pnpm --filter @support/api exec vitest run -t 'rejects the wrong password'` | One test by name |
| `pnpm db:reset` | Drop, re-migrate, re-seed |
| `pnpm db:migrate:deploy` | The one-off migration task; what deploys run |

`apps/api` and `apps/web` import `@support/shared` through its **built** `dist/`,
which is gitignored. If either fails with `TS2307: Cannot find module
'@support/shared'`, run `pnpm --filter @support/shared build`.

## Architecture

**Two processes, one Docker image, different entrypoints.** `api` serves
`/api/*` and scales horizontally. `worker` polls Gmail and drains the job queue,
and must stay at **exactly one task** — the job queue is concurrency-safe via
`FOR UPDATE SKIP LOCKED`, but two Gmail pollers racing on the same `historyId`
double-create tickets.

**Same-origin is a constraint, not a convenience.** CloudFront serves the SPA at
`/` and routes `/api/*` to the ALB; Vite's dev proxy mirrors this. It is what
keeps session cookies `SameSite=Lax` with no CORS. Do not introduce a
cross-origin API URL.

**`packages/shared` is the wire contract** — domain enums and API response
shapes used by both sides. `apps/api/src/domain/enums.ts` holds compile-time
assertions that the Prisma enums and the shared enums are identical; if it fails
to typecheck, the two have drifted and one of them is wrong.

**Backend is structured by domain**, not by technical layer. `src/http/` is
Express plumbing (error middleware, request context); domain modules live
alongside it.

**No public unauthenticated routes.** Email is polled rather than pushed, so
there is no webhook to expose. Everything except `/api/health` sits behind
session auth from Phase 2 onward.

## Invariants enforced by the database

`apps/api/prisma/migrations/*/migration.sql` carries CHECK constraints and
`ON DELETE RESTRICT` foreign keys that the Prisma schema language cannot
express. They exist because the application is not the only writer — seeds,
scripts, and a `psql` session all bypass it — and because each of these fails
*silently* if only enforced in code:

- **Every outbound message has a named human author.** The AI never sends.
- **`aiDrafted` / `aiDraftEdited` cannot disagree**, and `aiDrafted` has no
  default, so a send path that forgets it fails to compile rather than
  recording a false negative. This pair is the accept/edit/reject signal the
  primary success metric is derived from and **cannot be reconstructed later**.
- **An audit entry attributed to a user names one.** The audit log is
  append-only; there are no update or delete paths in application code.
- **Message authors and audit actors cannot be deleted.** Departed users are
  deactivated, never deleted, so their name stays on every reply they sent.

## Domain rules that shape the code

- **Every status change goes through the transition service** (Phase 3) — never
  a raw `prisma.ticket.update({ data: { status } })`. Every transition writes an
  audit event.
- **`CLOSED` is terminal.** A reply to a closed ticket opens a *new* ticket,
  cross-linked to the original. This is why `gmailThreadId` is indexed but
  **not unique**: reply mapping resolves to the newest non-closed ticket for a
  thread.
- **`waiting_on` is the triage signal**, not the status. The default queue view
  is `status = OPEN AND waitingOn = US`, oldest first.
- **Classification never gates the agent.** `PENDING` or `FAILED` leaves the
  ticket fully workable; `FAILED` surfaces a manual-triage badge.
- **Grounding is a hard requirement.** If nothing in the knowledge base supports
  an answer, the draft is *withheld* and the ticket flagged for research —
  never answered from the model's own knowledge. Withheld drafts measure
  knowledge base coverage, not AI quality.
- **Gmail idempotency** is the Gmail message ID, enforced by a unique index —
  not by a read-then-write check.
- **Attachments go through the storage abstraction** (`apps/api/src/storage`),
  never the AWS SDK directly. The driver is constructed at boot so a
  misconfigured one crashes the deploy rather than the first attachment.

## Conventions worth knowing

- **`.env` lives at `apps/api/.env`** so the Prisma CLI and `node --env-file`
  read the same file. The environment is parsed once at boot through Zod and the
  process exits if it does not validate.
- **Tests run against `support_test`**, truncating between files. Never point
  `TEST_DATABASE_URL` at the dev database.
- **Migrations run as a one-off task before deploy**, never on container start —
  concurrent tasks would race.
- **Seed fixtures are production-grade code, not scaffolding.**
  `apps/api/prisma/seeds/ticket-fixtures.ts` is both the development corpus and
  the Phase 5 classification eval set. Its assertions encode real requirements
  (corpus size for a stable accuracy gate, queue depth for pagination, labeled
  ambiguous cases). Adding fixtures is normal; weakening those assertions is not.
- **`docs/` and `README.md` are prettier-ignored** — Prettier reflows markdown
  tables and makes spec diffs unreadable.
- Model the whole schema up front, including tables whose phases are months out.
  Retrofitting a column onto a live table is a data migration; adding it to the
  initial migration is free.

## Reviewing

`.claude/agents/code-reviewer.md` defines a project-specific read-only reviewer
that knows these invariants and which phase has shipped. Use it after completing
a task or phase, before committing.

## When writing AI integration code

The stack specifies `@anthropic-ai/sdk` with `claude-opus-5`, tuning `effort`
per call (`low` for classification and summaries, `high` for drafts) rather than
swapping model tiers. Read the `claude-api` skill for current model IDs,
pricing, and SDK usage before writing integration code — do not answer from
memory. Prompt order is stable-first (system → knowledge base → ticket body);
anything volatile before the cache breakpoint silently destroys the cache hit
rate, which is a cost multiple rather than an error.
