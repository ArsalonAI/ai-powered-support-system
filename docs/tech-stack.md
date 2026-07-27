# Tech Stack

Decisions for the AI-powered support system. See [prd.md](./prd.md) for scope.

## Summary

| Layer | Choice |
| --- | --- |
| Frontend | React + TypeScript (Vite), Tailwind + shadcn/ui, TanStack Table + TanStack Query |
| Backend | Node + Express + TypeScript |
| Database | PostgreSQL, installed locally |
| ORM | Prisma |
| Auth | Local users in Postgres, password + server-side session cookie |
| Email | Gmail API — History-API polling in, Gmail send out |
| AI | `@anthropic-ai/sdk`, `claude-opus-5` |
| Observability | OpenTelemetry SDK, OTLP out |
| Hosting | None. This runs on a developer machine. |

**This system runs locally.** There is no container image, no cloud account, no
CI pipeline, and no deployment target. The only external services it talks to
are the Gmail API and the Anthropic API — everything else is a process or a file
on the machine running it. Nothing below should reintroduce infrastructure to
solve a problem that a single machine does not have.

## Processes

Two Node processes against one Postgres, started together by `pnpm dev`:

- **`api`** — Express. Serves `/api/*`.
- **`worker`** — polls Gmail for new mail, processes queued AI jobs (classify,
  summarize, draft), and runs housekeeping on a plain interval. **Exactly one
  process.** It does not touch ticket status: the timed auto-resolve and
  auto-close sweeps were removed, and nothing moves a ticket without a person.

They are split because their failure modes and lifetimes differ: a crash in the
Gmail poller should not take down the API, and restarting the API on a file save
should not restart a poll cycle mid-flight.

The worker must stay at one process. The job queue is concurrency-safe via
`FOR UPDATE SKIP LOCKED`, but the Gmail polling loop is not — two pollers racing
on the same `historyId` will double-create tickets.

**That is enforced by a Postgres advisory lock, not by instructions.** The
worker takes the lock at boot on a dedicated connection and exits if another
holds it, so a second `pnpm dev` is a no-op rather than a corruption. The lock
releases when the connection drops, so a killed worker never locks out its
replacement. This is deliberately the same principle as the CHECK constraints in
the migration: an invariant that fails silently when enforced only by convention
belongs in the database.

## Frontend

Vite + React + TypeScript. `pnpm dev` serves it; `pnpm build` emits static
assets to `dist/`.

- **TanStack Query** for server state.
- **TanStack Table** for the ticket list (filter, sort, paginate).
- **shadcn/ui + Tailwind** for components.

### Same-origin requirement

The browser sees one origin: Vite serves the SPA at `/` and proxies `/api/*` to
the `api` process. This is a deliberate constraint, not a convenience:

- Session cookies work with `SameSite=Lax` — no `SameSite=None`, no third-party
  cookie exposure.
- No CORS, no preflight on every mutation.

## Backend

Express + TypeScript. Structure by domain (`tickets/`, `email/`, `ai/`, `kb/`,
`users/`), not by technical layer.

- **Validation:** Zod at every route boundary. Inbound email is untrusted input.
- **Errors:** one error middleware; never leak stack traces past it.
- **Config:** parse the environment once at boot through a Zod schema and fail
  fast. A missing Gmail or Anthropic credential should crash at startup, not on
  the first ticket. `apps/server/.env` is the whole configuration story.

**No public unauthenticated routes.** Because email is polled rather than pushed,
every route except `/api/health` sits behind session auth. There is no webhook
endpoint to expose, verify, or rate-limit.

## Auth

**Identity:** local user records in Postgres, email + password. No external
identity provider. Owning the credential means owning hashing, invitation,
reset, throttling, and revocation — all specified below, because none of it is
optional once you hold the password.

### Storage

- **Hash with argon2id** (`@node-rs/argon2`). bcrypt is acceptable if you prefer
  the more battle-tested option, but note its silent 72-byte truncation.
- Never log, return, or include the hash in any serialized user object. Use an
  explicit `select` in Prisma rather than relying on remembering to strip it.
- Password policy: minimum 12 characters, checked against a breach list
  (`zxcvbn` for strength, or HIBP's k-anonymity range API). No composition rules
  — they push users toward `Password1!` and weaken outcomes.

### Sessions

`express-session` + `connect-pg-simple`, sessions in the same Postgres.

- Cookie: `httpOnly`, `secure`, `SameSite=Lax`.
- **Regenerate the session ID on login** (`req.session.regenerate()`). Without
  it the app is open to session fixation.
- Idle timeout with rolling renewal, plus a hard absolute lifetime.
- **Sessions are queryable by user ID.** This is a requirement, not a nicety —
  see revocation below. Store `userId` in the session row (a generated column or
  an explicit indexed column) so it can be looked up.

**CSRF:** cookie sessions require CSRF tokens on state-changing requests.
`SameSite=Lax` blocks the common cases but is not sufficient alone — this is the
tax for cookies over bearer tokens.

### Account lifecycle

The PRD specifies no self-service signup, so provisioning is an invite flow:

1. Admin creates the user record (email + role), no password set.
2. System emails a single-use invite token.
3. User follows the link and sets their password.

Invite and reset tokens follow the same rules: cryptographically random, **stored
hashed** (a token in a stolen DB dump is a live credential otherwise), single-use,
and short-lived — 72h for invites, 1h for resets.

**Password reset** invalidates every existing session for that user. So does an
admin-initiated reset, and so does deactivation.

**Deactivation must kill sessions immediately.** The PRD deactivates rather than
deletes departed users; if their session cookie still authenticates until it
expires, deactivation is cosmetic. Delete all session rows for that user ID at
the moment the account is disabled.

### Login hardening

- **Rate limit per account *and* per IP**, with exponential backoff.
- **Prefer backoff over hard lockout.** A lockout policy hands an attacker a
  denial-of-service against your support team: guess wrong five times against
  every agent's email and nobody can log in during an incident.
- **Always run a hash, even for an unknown email**, and return a single generic
  message ("invalid email or password"). Skipping the hash on a missing user
  leaks account existence through response timing.
- Password reset responses are likewise generic ("if an account exists, we've
  sent a link"), for the same reason.

### Bootstrap

There is no signup, so the first admin must be seeded — `pnpm db:seed` creates
an admin from `BOOTSTRAP_ADMIN_*` in `.env` and forces a password change on
first login. Easy to forget until a fresh database leaves you locked out of your
own system.

### Authorization

Role (`AGENT` | `ADMIN`) on the user row, checked in middleware. Admin is a
strict superset — see the PRD.

## Database and ORM

Prisma against Postgres.

- **Enums** for `TicketStatus`, `TicketCategory`, `WaitingOn`,
  `ClassificationState`, `Role` — the state machine belongs in the schema.
- **Connection pooling:** set `connection_limit` explicitly in the datasource
  URL rather than taking Prisma's default (`num_cpus * 2 + 1`), which varies by
  machine. Two processes share one local server.
- **Audit log is append-only.** No update or delete paths in application code.
- **Migrations are a deliberate command** (`pnpm db:migrate`), never something
  a process runs on start.
- **Model the full schema up front**, including tables whose features are phases
  away. Retrofitting Gmail `threadId` storage or session-by-user lookup onto a
  live table is a data migration; adding them to the initial migration is free.
- **Seed fixtures are production-grade code.** Email integration lands after
  ticket and AI work, so those phases are built and evaluated entirely against
  seeded tickets — realistic bodies across all three categories. The same corpus
  becomes the AI eval set. Seed several agent users alongside the bootstrap
  admin: user management ships after ticket work, so assignment, author
  attribution, and audit entries have nothing to reference otherwise.

### Job queue

A `Job` table plus a worker polling with `FOR UPDATE SKIP LOCKED`. No pg-boss,
no Redis, no BullMQ.

At under 50 tickets/day (see the PRD's non-functional requirements), and with no
scheduled-send semantics to get right, a job library would add a second schema
for Prisma Migrate to fight with in exchange for features we don't use. Jobs are
best-effort with a retry count; if one is lost, the ticket is still visible and
workable without its AI draft.

### Attachment storage

Inbound attachments are written to the local disk under `STORAGE_LOCAL_ROOT`,
never into the database.

They go through a small storage interface (`put` / `get` / `signedUrl` /
`exists` / `delete`) rather than `node:fs` at the call site. The seam is worth
keeping even with a single driver: attachment keys are built from
attacker-influenced Gmail IDs, and one place that validates them beats every
handler remembering to. The driver is constructed at boot, so a misconfigured
root fails at startup rather than on the first email that carries a file.

## Email

**Gmail API** (`googleapis`) against a single shared mailbox, both directions.
No DNS changes, no MX records, no SPF/DKIM setup — the domain is already
configured for Workspace, and deliverability is Google's problem.

### Setup

One-time, roughly half an hour, no DNS involved:

1. Google Cloud project; enable the Gmail API.
2. OAuth client; consent once as the shared mailbox account.
3. Put the resulting **refresh token** in `apps/server/.env`.

**Confirm before building:** the shared inbox must be a real mailbox, not a
Google Group. Groups do not expose the same API surface.

> **Durability tradeoff.** A refresh token is tied to the account that granted
> it and can be revoked by a password change or an admin policy change. A
> service account with domain-wide delegation is more durable but requires a
> Workspace superadmin to configure. Start with the refresh token; move to
> delegation if revocations become a recurring operational problem.

### Inbound — polling

The worker calls `users.history.list` from the stored `historyId` every 30–60
seconds.

- **Threading is free.** Gmail's `threadId` maps a reply to its ticket. No
  `Message-ID` bookkeeping, no `In-Reply-To`/`References` parsing, no
  per-mail-client edge cases.
- **`historyId` expires** after roughly a week of inactivity. Handle the 404
  with a bounded full resync rather than crashing.
- **Store the Gmail message ID** and treat it as an idempotency key — a poll
  that overlaps a retry must not create the ticket twice.
- **Attachments** go to the storage driver, never the database.
- Suppress auto-responders and mail loops; drop obvious spam.

Polling latency of 30–60 seconds is irrelevant here: every reply is written and
sent by a human anyway.

### Outbound

Gmail API send, with `threadId` set so replies land in the customer's existing
conversation rather than starting a new one.

- The **~2,000 sends/day** Workspace quota clears expected volume by more than
  10× (under 50 tickets/day, ~150 at peak). Still alarm on 429s — the quota is
  per account, not per application, and other Workspace usage counts against it.
- Handle 429s with backoff; surface persistent send failures to the agent
  rather than silently retrying forever.

## AI

`@anthropic-ai/sdk`, model `claude-opus-5`, adaptive thinking, `effort` tuned
per call rather than swapping model tiers:

| Call | Effort | Notes |
| --- | --- | --- |
| Classification | `low` | Structured output: category enum + confidence |
| Summary | `low` | |
| Draft reply | `high` | The agent's starting point; quality here drives adoption |

- **Structured outputs** (`output_config.format`) for classification. Never
  parse free text into a state machine.
- **Prompt caching** on the knowledge base + system prompt. Order the prompt
  stable-first: system prompt → KB → ticket body. Anything volatile placed
  before the cache breakpoint silently destroys the hit rate. Verify with
  `usage.cache_read_input_tokens` — if it is zero across requests, something is
  invalidating the prefix.
- **Knowledge base in the cached prompt, not a vector store**, until measurement
  says otherwise. Measure with `messages.countTokens`; under ~200k tokens, send
  the whole KB. This removes embeddings, chunking, and retrieval-quality
  failures. Add `pgvector` to the same Postgres if the KB outgrows it.
- **Grounding:** if no supporting KB content exists, withhold the draft and flag
  the ticket for manual research. A confidently wrong draft is worse than no
  draft, because it is the path of least resistance for a busy agent.
- **Prompt injection:** customer email goes into the prompt, so delimit the body
  and instruct the model to treat it as data. With auto-send gone this is
  substantially defanged — the model has no tools and no send path, and a human
  reads every reply before it leaves.

## Observability

OpenTelemetry SDK in both processes. There is no collector to run: the exporter
is the console by default, and `OTEL_EXPORTER_OTLP_ENDPOINT` points it at a local
Jaeger or an OTLP-compatible backend when you actually want to read traces.
Structured logs come from `pino` and go to stdout.

The instrumentation is not here for uptime — one machine's uptime is visible
without it. It is here because it is the only way to see what the AI is costing
and whether it is working.

- **Auto-instrumentation** for HTTP and Express. Prisma emits OTel spans with
  its tracing feature enabled.
- **Ticket ID as a span attribute** on everything, so one ticket's full path —
  poll, classify, summarize, draft, send — is a single queryable trace.
- **Custom spans** around each Anthropic call, with model, effort, input/output
  tokens, cache read tokens, and latency as attributes. This is the cost
  dashboard; without it, spend is unattributable.
- **Custom metrics:** tickets ingested, classification confidence distribution,
  drafts generated vs. withheld for lack of grounding, and **draft accepted /
  edited / rejected**.

That last metric is product scope, not ops. It is the primary success measure
for the whole system and must be instrumented from the first commit — unlike
latency or error rate, there is no log to mine it out of later.

**Tracing is not alerting.** The load-bearing signal is a dead-man's switch:
**no inbound email polled in N hours**. The polling loop can die quietly — a
revoked refresh token, an unhandled `historyId` expiry, a crashed worker — and
nothing else will tell you the product has stopped receiving work. Locally it
surfaces as a banner in the SPA and an error-level log line; there is no pager.

## Running it

```
psql postgres -f apps/server/scripts/create-databases.sql   # once
pnpm install && pnpm db:migrate && pnpm db:seed
pnpm dev
```

That is the whole operational surface: a local Postgres, `pnpm dev`, and an
`.env`. Verification is `pnpm typecheck && pnpm lint && pnpm format:check &&
pnpm test && pnpm build`, run on the machine you are working on.

Backups are `pg_dump`. Rolling back a bad migration is `pnpm db:reset` plus a
re-seed, because the only data at risk is a seeded corpus. Both of those stop
being adequate the moment a real customer's mail lands in this database — see
below.

### When this needs to leave the laptop

Expected eventually, but not specified yet — this document stops at the local
setup, and hosting decisions belong in a revision of it rather than in code
written ahead of one.

The *architecture* does not block the move: Postgres, the storage seam behind
`put`/`get`/`signedUrl`, the plain `Job` table, and the same-origin rule are all
standard and portable. What a hosting revision has to work through is the list
this one has not solved — TLS and a real `secure` session cookie, secret storage
that is not a file in the working tree, backups with a rehearsed restore, a
durable home for attachments, keeping the worker pinned to exactly one instance,
and a migration step that runs before the new code does.

Two things in the current design are worth *not* undoing on the way, because
they were chosen with this in mind: attachments already go through the storage
abstraction rather than `node:fs`, and the SPA already calls `/api/*` relative
rather than an absolute URL.

## Open items

- Confirm the shared inbox is a real mailbox, not a Google Group.
- Confirm expected daily send volume clears the Workspace quota.
- Session idle and absolute timeout values.
- Whether the AI can read order/billing data. Until then, `refund request`
  tickets can only be answered with policy, not status.
- Data retention and PII policy.
