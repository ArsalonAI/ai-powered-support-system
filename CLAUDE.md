# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An email support CRM for a small in-house team (1–3 agents, under 50 tickets/day).
Customer email becomes a ticket; Claude classifies it, summarizes the thread, and
drafts a reply citing knowledge base sources. **A human reviews and sends every
message** — the AI has no send path.

**It runs locally today.** No Docker, no cloud account, no CI pipeline, no
deployment target — the only things it talks to over the network are the Gmail
and Anthropic APIs. Hosting is expected to come back on the table later but is
not specified anywhere yet, so build against the local setup and treat its
absence as the current state of the plan rather than a gap to fill in passing.

## The specs are the source of truth

Three documents in `docs/` are the specification, not background reading. Code
that contradicts them is a defect even when it is internally consistent:

| Document | Governs |
| --- | --- |
| `docs/prd.md` | Roles, ticket lifecycle, grounding rule, success metrics |
| `docs/tech-stack.md` | Stack choices *and their rationale* — read the rationale before proposing an alternative |
| `docs/implementation-plan.md` | Task-level build order, numbered `1.1`–`8.11`. **Phase 2 is Ticket CRUD and Phase 3 is Authentication** — they were swapped deliberately |

**The build is phase-driven and largely sequential.** `README.md`'s Status
section is the record of what has actually shipped. Work the numbered tasks of
the current phase; do not build ahead into a later one on your own initiative.
Conversely, do not report a later phase's absence as a bug — **Phases 1 and 2
have no login by design.** Authentication is Phase 3, deliberately after ticket
work so the queue can be driven against the seeded corpus.

**One reorder has been taken, deliberately.** Phase 4 (User management) is
deferred, and the first slice of Phase 5 shipped in its place: **5.1** (job
queue), **5.2** (Anthropic client wrapper) and **5.9** (ticket summarization),
with an on-demand trigger. The plan names Phase 4 as its one genuinely movable
block — ticket work needs users to *exist*, not to be *manageable*, and the 1.16
seeded agents supply that. Do not treat the missing admin CRUD as a defect, and
do not treat the AI code as building ahead. Everything else in Phase 5 —
knowledge base, classifier, drafts, grounding gate, OTel — is still unbuilt.

Several decisions look like over-engineering until you read why: the plain
`Job` table instead of a job library, the knowledge base in a cached prompt
instead of a vector store, the single worker process, the storage abstraction
over one filesystem driver. Each has a documented threshold for revisiting.
Check it before changing course.

## Commands

Postgres is a local install. Once, to create the role and both databases:
`psql postgres -f apps/server/scripts/create-databases.sql`. Then:

```bash
pnpm install                                  # builds packages/shared via its prepare script
cp apps/server/.env.example apps/server/.env  # then edit the bootstrap admin credentials
pnpm db:migrate && pnpm db:seed
pnpm dev                                      # api :3000, client :5173, worker (all three)
```

| Command | Notes |
| --- | --- |
| `pnpm typecheck` \| `lint` \| `format:check` \| `test` \| `build` | The verification sequence, in that order — nothing runs it for you |
| `pnpm --filter @support/server test` | Migrates the test database first, then runs Vitest |
| `pnpm --filter @support/server exec vitest run src/auth/password.test.ts` | One file — skips the test-DB migration, so run the line above at least once first |
| `pnpm --filter @support/server exec vitest run -t 'rejects the wrong password'` | One test by name |
| `pnpm db:reset` | Drop, re-migrate, re-seed |

`apps/server` and `apps/client` import `@support/shared` through its **built** `dist/`,
which is gitignored. If either fails with `TS2307: Cannot find module
'@support/shared'`, run `pnpm --filter @support/shared build`.

## Architecture

**Two processes against one Postgres**, both started by `pnpm dev`. `api` serves
`/api/*`. `worker` polls Gmail, drains the job queue, and runs housekeeping —
**never ticket status**, since the timed sweeps were cut.

**Exactly one worker, enforced by a Postgres advisory lock** (`src/jobs/worker-lock.ts`).
The job queue is concurrency-safe via `FOR UPDATE SKIP LOCKED`, but two Gmail
pollers racing on the same `historyId` double-create tickets. A second worker
takes the lock, fails, and exits 0 — so `pnpm dev` can start one automatically
and running it twice is harmless rather than corrupting. The lock lives on its
own connection, not a pooled one, so it releases when the process dies. Do not
replace it with a flag or a pidfile: this is the same reasoning as the CHECK
constraints, which is that an invariant enforced only in code fails silently.
`pnpm dev:worker` still runs it alone.

**Same-origin is a constraint, not a convenience.** Vite serves the SPA at `/`
and proxies `/api/*` to the API, so the browser sees one origin. It is what
keeps session cookies `SameSite=Lax` with no CORS. Do not introduce a
cross-origin API URL.

**`packages/shared` is the wire contract** — domain enums and API response
shapes used by both sides. `apps/server/src/domain/enums.ts` holds compile-time
assertions that the Prisma enums and the shared enums are identical; if it fails
to typecheck, the two have drifted and one of them is wrong.

**Backend is structured by domain**, not by technical layer. `src/http/` is
Express plumbing (error middleware, request context); domain modules live
alongside it.

**No public unauthenticated routes — from Phase 3 onward.** Email is polled
rather than pushed, so there is no webhook to expose. Everything except
`/api/health` sits behind session auth once Phase 3 lands. Until then the whole
API is open, which is why every route is mounted as one block in `src/app.ts`:
Phase 3 wraps that block, rather than sweeping every file.

## Invariants enforced by the database

`apps/server/prisma/migrations/*/migration.sql` carries CHECK constraints and
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

- **Every status change goes through the transition service** (Phase 2) — never
  a raw `prisma.ticket.update({ data: { status } })`. Every transition writes an
  audit event.
- **Anything needing "who is acting" goes through `getActingUser(req)`** — the
  temporary seam from task 2.1, never an ad-hoc user lookup. It resolves to a
  real seeded agent, so the author and audit-actor CHECK constraints stay
  satisfied with genuine IDs. Task 3.13 **deletes** it and moves the call sites
  to `req.session.userId`; it refuses to construct when `NODE_ENV=production`,
  because an impersonation header must never outlive the phase that needed it.
- **`CLOSED` is terminal.** A reply to a closed ticket opens a *new* ticket,
  cross-linked to the original. This is why `gmailThreadId` is indexed but
  **not unique**: reply mapping resolves to the newest non-closed ticket for a
  thread.
- **No ticket changes status without a person.** The 7-day auto-resolve and
  14-day auto-close were built and then cut — a queue that tidies itself
  under-reports its backlog, and the ticket it tidied away is the one nobody got
  to. Do not reintroduce a timed transition; a stale-ticket *report* is the
  thing to build instead. The transition-service tests fail if a sweep returns.
- **`waiting_on` is the triage signal**, not the status. The default queue view
  is `status = OPEN AND waitingOn = US`, oldest first.
- **Classification and summarization never gate the agent.** `PENDING` or
  `FAILED` leaves the ticket fully workable; `FAILED` surfaces a badge. The
  summary is an orientation aid sitting above the thread it summarizes — if it
  is missing, late, or failed, the agent reads the thread. Never block a reply,
  a transition, or a queue view on AI output.
- **A summary is not a status change**, so it does not go through the transition
  service. It writes an audit event with `actorType = SYSTEM` and a null
  `actorId` — the one kind of change no person made.
- **Grounding is a hard requirement.** If nothing in the knowledge base supports
  an answer, the draft is *withheld* and the ticket flagged for research —
  never answered from the model's own knowledge. Withheld drafts measure
  knowledge base coverage, not AI quality.
- **Gmail idempotency** is the Gmail message ID, enforced by a unique index —
  not by a read-then-write check.
- **Attachments go through the storage abstraction** (`apps/server/src/storage`),
  never `node:fs` at the call site. Keys are built from attacker-influenced
  Gmail IDs and are validated in exactly one place. The driver is constructed at
  boot so a misconfigured root crashes startup rather than the first attachment.

## Conventions worth knowing

- **`.env` lives at `apps/server/.env`** so the Prisma CLI and `node --env-file`
  read the same file. The environment is parsed once at boot through Zod and the
  process exits if it does not validate.
- **Tests run against `helpdesk_test`**, truncating between files. Never point
  `TEST_DATABASE_URL` at the dev database. Both databases come from
  `apps/server/scripts/create-databases.sql`.
- **Migrations are a deliberate command**, never something a process runs on
  start.
- **Seed fixtures are production-grade code, not scaffolding.**
  `apps/server/prisma/seeds/ticket-fixtures.ts` is both the development corpus and
  the Phase 5 classification eval set. Its assertions encode real requirements
  (corpus size for a stable accuracy gate, queue depth for pagination, labeled
  ambiguous cases). Adding fixtures is normal; weakening those assertions is not.
- **`docs/` and `README.md` are prettier-ignored** — Prettier reflows markdown
  tables and makes spec diffs unreadable.
- Model the whole schema up front, including tables whose phases are months out.
  Retrofitting a column onto a live table is a data migration; adding it to the
  initial migration is free.

## Looking up library documentation

**Use the `context7` MCP server to fetch current docs before writing code against
a library** — `resolve-library-id` to find the library, then `query-docs`. Do
this even when you are confident, and especially for configuration, setup, and
migration questions.

This is not generic caution. Nearly every dependency here is on a major version
that broke its predecessor's API, and the wrong-version answer usually *looks*
right:

| | Where memory tends to be stale |
| --- | --- |
| Express 5 | async error propagation, removed path-matching syntax |
| Prisma 6 | `prisma.config.ts` replacing `package.json#prisma`, client generation output |
| React 19 + React Router 7 | the `react-router` package replacing `react-router-dom` |
| Tailwind 4 | CSS-first config, `@theme`, the Vite plugin — no `tailwind.config.js` |
| Zod 3 | v4 moved and renamed enough API that v4 answers fail to compile here |
| Vitest 3 / TanStack Query 5 | config surface and option names |

Do not use it for refactoring, business-logic debugging, or general programming
questions — it answers "what is this library's current API", nothing else.

**Anthropic and Claude questions go to the `claude-api` skill instead**, not
context7 — model IDs, pricing, `effort`, caching, and SDK usage all live there.

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

The shape to follow, established by the summarize job:

- **Every Anthropic call goes through `src/ai/client.ts`.** It owns the model,
  the timeout, and the parameter decisions. Do not call the SDK from a domain
  module.
- **`AiClient` is an interface so it can be faked.** Tests inject a stub and the
  suite runs with no `ANTHROPIC_API_KEY` — keep it that way. A test that can
  reach the real API is a test that can bill for a run.
- **Every failure is classified retryable or terminal** in `src/ai/errors.ts`.
  That single bit is what the queue uses to reschedule or dead-letter; a 400 or
  a bad key must not consume five attempts.
- **Do not set `thinking`, `temperature`, `top_p`, or `top_k`** — the latter
  three are rejected by this model, and unset `thinking` means adaptive, which
  is what you want. Control spend with `effort`.
- **Structured output, not free text**, via `output_config.format`. Assistant
  prefills are rejected by this model; a JSON schema is the replacement.
- **Delimit customer-supplied text** and tell the model to treat it as data.
  Anyone can email the support address.
- **AI work runs in the worker, never in a request.** A route enqueues a job and
  returns 202; the browser polls. See `src/jobs/`.
