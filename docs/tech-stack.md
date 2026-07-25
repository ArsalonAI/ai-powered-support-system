# Tech Stack

Decisions for the AI-powered support system. See [prd.md](./prd.md) for scope.

## Summary

| Layer | Choice |
| --- | --- |
| Frontend | React + TypeScript (Vite), Tailwind + shadcn/ui, TanStack Table + TanStack Query |
| Backend | Node + Express + TypeScript |
| Database | PostgreSQL (RDS) |
| ORM | Prisma |
| Auth | Local users in Postgres, password + server-side session cookie |
| Email | Gmail API — History-API polling in, Gmail send out |
| AI | `@anthropic-ai/sdk`, `claude-opus-5` |
| Observability | OpenTelemetry → ADOT collector → CloudWatch / X-Ray |
| Packaging | Docker |
| Hosting | AWS: ECS Fargate, RDS, ALB, CloudFront, S3, Secrets Manager, EventBridge |

## Processes

One Docker image, two ECS services, different entrypoints:

- **`api`** — Express. Serves `/api/*`. Horizontally scalable.
- **`worker`** — polls Gmail for new mail and processes queued AI jobs
  (classify, summarize, draft). **Single instance.**

Plus **EventBridge scheduled tasks** for the auto-resolve (7-day) and
auto-close (14-day) sweeps.

The worker must stay at one task. The job queue is concurrency-safe via
`FOR UPDATE SKIP LOCKED`, but the Gmail polling loop is not — two pollers
racing on the same `historyId` will double-create tickets.

## Frontend

Vite + React + TypeScript, built to static assets and served from S3 behind
CloudFront.

- **TanStack Query** for server state.
- **TanStack Table** for the ticket list (filter, sort, paginate).
- **shadcn/ui + Tailwind** for components.

### Same-origin requirement

CloudFront serves the SPA at `/` and routes `/api/*` to the ALB in front of the
`api` service. This is a deliberate constraint, not a convenience:

- Session cookies work with `SameSite=Lax` — no `SameSite=None`, no third-party
  cookie exposure.
- No CORS, no preflight on every mutation.

## Backend

Express + TypeScript. Structure by domain (`tickets/`, `email/`, `ai/`, `kb/`,
`users/`), not by technical layer.

- **Validation:** Zod at every route boundary. Inbound email is untrusted input.
- **Errors:** one error middleware; never leak stack traces past it.
- **Config:** parse the environment once at boot through a Zod schema and fail
  fast. A missing Gmail or Anthropic credential should crash on deploy, not on
  the first ticket.

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

There is no signup, so the first admin must be seeded — a one-off ECS task that
creates an admin from Secrets Manager values and forces a password change on
first login. Easy to forget until the first deploy leaves you locked out of your
own system.

### Authorization

Role (`AGENT` | `ADMIN`) on the user row, checked in middleware. Admin is a
strict superset — see the PRD.

## Database and ORM

Prisma against Postgres.

- **Enums** for `TicketStatus`, `TicketCategory`, `WaitingOn`,
  `ClassificationState`, `Role` — the state machine belongs in the schema.
- **Connection pooling:** Fargate tasks × Prisma pool size must stay under the
  RDS `max_connections`. Set `connection_limit` explicitly in the datasource URL
  rather than taking the default.
- **Audit log is append-only.** No update or delete paths in application code.
- **Migrations run as a one-off ECS task** before the service deploys, never on
  container start — concurrent tasks would race.
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

At this volume, and with no scheduled-send semantics to get right, a job library
would add a second schema for Prisma Migrate to fight with in exchange for
features we don't use. Jobs are best-effort with a retry count; if one is lost,
the ticket is still visible and workable without its AI draft.

## Email

**Gmail API** (`googleapis`) against a single shared mailbox, both directions.
No DNS changes, no MX records, no SPF/DKIM setup — the domain is already
configured for Workspace, and deliverability is Google's problem.

### Setup

One-time, roughly half an hour, no DNS involved:

1. Google Cloud project; enable the Gmail API.
2. OAuth client; consent once as the shared mailbox account.
3. Store the resulting **refresh token** in Secrets Manager.

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
- **Attachments** go to S3, never the database.
- Suppress auto-responders and mail loops; drop obvious spam.

Polling latency of 30–60 seconds is irrelevant here: every reply is written and
sent by a human anyway.

### Outbound

Gmail API send, with `threadId` set so replies land in the customer's existing
conversation rather than starting a new one.

- Watch the **~2,000 sends/day** Workspace quota. Confirm it clears your
  expected volume with headroom.
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

OpenTelemetry SDK in both processes, exporting OTLP to an **ADOT collector
sidecar**, which forwards to CloudWatch (metrics/logs) and X-Ray (traces).

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

**Tracing is not alerting.** The load-bearing alarm is a dead-man's switch:
**no inbound email polled in N hours**. The polling loop can die quietly — a
revoked refresh token, an unhandled `historyId` expiry, a crashed worker task —
and nothing else will tell you the product has stopped receiving work.

## Packaging and deployment

**Docker:** multi-stage build, `node:22-alpine` runtime, non-root user, one
image for both services with different `command`s.

**AWS:**

- **ECR** for images
- **ECS Fargate** — `api` service (≥2 tasks, behind ALB) and `worker` service
  (exactly 1 task)
- **RDS Postgres** — Multi-AZ, automated backups, private subnet only
- **ALB** for the API; **CloudFront + S3** for the SPA, with `/api/*` routed to
  the ALB from the same distribution
- **Secrets Manager** — Anthropic API key, Google OAuth client ID/secret, Gmail
  refresh token, session secret, bootstrap admin credentials, DB credentials.
  Injected as ECS task secrets, never baked into images.
- **EventBridge** — scheduled auto-resolve and auto-close sweeps
- **CloudWatch** — logs, metrics, and the dead-man's-switch alarm

**Deploy order:** build → push → run migration task → update services.

Because email is polled rather than pushed, no phase is blocked on having
deployed infrastructure — the whole system, email included, runs against a local
Postgres and a real Gmail mailbox during development.

## Open items

- Confirm the shared inbox is a real mailbox, not a Google Group.
- Confirm expected daily send volume clears the Workspace quota.
- Session idle and absolute timeout values.
- Whether the AI can read order/billing data. Until then, `refund request`
  tickets can only be answered with policy, not status.
- Data retention and PII policy.
