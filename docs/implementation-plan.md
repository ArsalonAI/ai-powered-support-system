# Implementation Plan

Sequenced build plan for the AI-powered support system.
See [prd.md](./prd.md) for scope and [tech-stack.md](./tech-stack.md) for stack decisions.

## Phases

| # | Phase | Delivers | Size |
|---|---|---|---|
| 1 | Project setup | Scaffolding, database, Prisma schema, admin seed | 8S · 11M |
| 2 | Ticket CRUD | Core ticket operations, list/detail with filtering | 4S · 10M · 2L |
| 3 | Authentication | Login, sessions, route protection | 5S · 8M |
| 4 | User management | Admin CRUD for agents, role-based access | 2S · 6M |
| 5 | AI features | Claude integration: classification, summaries, suggested replies | 3S · 12M · 3L |
| 6 | Email integration | Gmail polling → tickets, outbound replies | 1S · 12M |
| 7 | Dashboard | Stats overview, category breakdown | 5M · 1L |
| 8 | Polish & hardening | Validation, error handling, degradation paths, runbook | 1S · 7M · 2L |

The build works inside-out: the domain model and AI are developed against seeded
tickets, and email is connected last. Two consequences to plan around:

- **Phase 2 needs seed fixtures.** Nothing creates tickets until Phase 6, so
  Phases 2 and 5 run against a realistic seeded dataset. Build that seed script
  early and make it good — it is also your AI eval corpus.
- **Seed a few agent users, not just an admin.** User management lands after
  ticket work, so ticket assignment, author attribution, and audit entries have
  nothing to point at unless Phase 1 seeds more than one account.

**Nothing here is blocked on infrastructure.** The whole system, email included,
runs against a local Postgres and a real Gmail mailbox. Attachments go to the
local disk (1.18, 6.7) and the worker's housekeeping runs on a plain interval —
neither is a stand-in for something else that arrives later.

The only external dependencies in the entire plan are the Gmail API and the
Anthropic API, and only Phases 5 and 6 touch them.

Sizes are relative (S ≈ hours, M ≈ a day or two, L ≈ several days). They are
sequencing aids, not estimates — no calendar was specified. Phase totals are
task counts by size, not durations.

### Why ticket work comes before authentication

Phases 2 and 3 are deliberately in this order: the ticket queue *is* the product,
and building it behind a login that does not exist yet means building it blind.
Putting Ticket CRUD first means the app can be opened and driven against the
seeded corpus from the first day of the phase.

The cost is specific and worth stating. Three ticket tasks write rows the
database refuses without a user — outbound messages need a named author, audit
entries attributed to a user need one, and assignment has nobody to claim as.
**Task 2.1 answers that with a temporary acting-user seam**, and **task 3.13
deletes it.** See the note under Phase 2.

---

## Prerequisite — do once, early

No DNS, no MX, no waiting on propagation. Roughly half an hour.

| # | Task | Size |
|---|---|---|
| P.1 | **Confirm the support inbox is a real mailbox, not a Google Group** | S |
| P.2 | Google Cloud project; enable the Gmail API | S |
| P.3 | OAuth client; consent once as the shared mailbox; capture the refresh token | S |
| P.4 | ✅ Send volume confirmed — under 50 tickets/day against a ~2,000/day quota | S |
| P.5 | **Decide the data retention and PII policy** — a decision, not code; gates 8.10 | M |

> P.1 is the one that bites. Google Groups do not expose the same API surface,
> and discovering that in Phase 6 means renegotiating which address support
> uses — after customers already have it.
>
> P.5 is here because 8.10 implements a policy that does not yet exist. Deciding
> it late means either a rushed decision or a blocked launch task; deciding it
> now costs a conversation.

---

## Phase 1 — Project setup

**Goal:** the schema exists, the app boots, an admin account can be seeded.

### 1a · Scaffolding

| # | Task | Size |
|---|---|---|
| 1.1 | Repo layout (`apps/server`, `apps/client`, `packages/shared`), pnpm workspaces | S |
| 1.2 | TypeScript strict mode, ESLint, Prettier | S |
| 1.3 | Vitest setup, one passing test per workspace | S |
| 1.4 | Local Postgres 17; a SQL script that creates the role and both databases | S |
| 1.5 | Express skeleton: `/api/health`, error middleware, Zod-validated env config | M |
| 1.6 | Vite + React skeleton, router, base layout, TanStack Query provider | M |
| 1.7 | Root scripts: `typecheck` → `lint` → `format:check` → `test` → `build` | S |

### 1b · Database & Prisma schema

| # | Task | Size |
|---|---|---|
| 1.8 | `User`, `Session`, `InviteToken`, `ResetToken` | M |
| 1.9 | `Customer`, `Ticket`, `Message`, `Attachment` | M |
| 1.10 | `KbDocument`, `Job`, `AuditEvent` | M |
| 1.11 | Enums: `Role`, `TicketStatus`, `TicketCategory`, `WaitingOn`, `ClassificationState` | S |
| 1.12 | Indexes: ticket list query, Gmail `threadId` / message ID lookup, session-by-user | M |
| 1.13 | Initial migration | M |

> Model the whole schema now, even for phases that are months out. Retrofitting
> Gmail ID storage or session-by-user lookup after the fact means a data
> migration on a live table.

### 1c · Seed data & developer surface

| # | Task | Size |
|---|---|---|
| 1.14 | Bootstrap-admin seed task (credentials from `.env`) | M |
| 1.15 | Force password change on first login — *column and seed only; enforced at 3.7* | S |
| 1.16 | **Seed a handful of agent users** — assignment and attribution need them before Phase 4 | S |
| 1.17 | Ticket seed fixtures — realistic bodies across all three categories | M |
| 1.18 | **Storage abstraction** (`put`/`get`/`signedUrl`) over a local filesystem driver — attachment keys come from attacker-influenced Gmail IDs and get validated in one place | M |
| 1.19 | OpenAPI document generated from the shared Zod schemas + Swagger UI at `/api/docs`, gated on `ENABLE_API_DOCS` | M |

> There is no self-service signup, so without 1.14 a fresh database locks you
> out of your own system. And 1.17 is not throwaway scaffolding — it is what
> Phases 2 and 5 are built and evaluated against.
>
> 1.19 generates the spec from the same schemas the server validates against, so
> it cannot drift from the code. It is how the seeded corpus gets explored before
> any UI exists — and it is an interactive console over customer data, which is
> why it is environment-gated rather than always on.

**Exit criteria:** create the databases, migrate, seed, and `pnpm dev` boots both
processes with the seeded corpus reachable over `/api`.

---

## Phase 2 — Ticket CRUD

**Goal:** the full ticket domain, worked by hand against seeded data — with no
login in the way.

### 2a · Core operations

| # | Task | Size |
|---|---|---|
| 2.1 | **Acting-user seam** — `getActingUser(req)` resolving to a seeded agent; dev-only, retired at 3.13 | S |
| 2.2 | Ticket create (internal), read, update | M |
| 2.3 | **Transition service** — every status change goes through it, never a raw update | M |
| 2.4 | `status`, `waiting_on`, `classification_state` handling | M |
| 2.5 | Resolve / close / reopen; 14-day cross-link on reply to a closed ticket | M |
| 2.6 | Message thread append (author, direction, timestamps) | M |
| 2.7 | Optional assignment: claim / unclaim, non-restrictive | S |
| 2.8 | Manual category set/override | S |
| 2.9 | ~~Scheduled sweeps: 7-day auto-resolve, 14-day auto-close~~ — **cut**, see below | — |
| 2.10 | Audit events on every transition | M |

> **2.1 exists because the database will not accept the alternative.**
> `messages_outbound_author_ck` rejects an outbound message with a NULL author,
> and `audit_events_actor_ck` requires an `actorId` on any entry attributed to a
> user. Without a session there is no `req.user`, so 2.6, 2.7, and 2.10 have
> nothing to write.
>
> The seam resolves to a **real seeded agent**, selected by an `x-acting-user`
> header that a dev-only switcher in the UI sets. Real user IDs get written, so
> the constraints stay honest and attribution, assignment, and audit entries are
> genuinely exercised rather than stubbed out. It must **refuse to construct when
> `NODE_ENV=production`**, the same way the storage driver does — a header that
> lets any caller act as any user must not survive by omission.
>
> For the length of this phase the app is a writable, unauthenticated CRM over
> customer data. That is the deliberate trade for being able to drive it, and it
> is bounded: 3.13 deletes the seam rather than bypassing it.

### 2b · List & detail UI

| # | Task | Size |
|---|---|---|
| 2.11 | Ticket list: filter by status, category, `waiting_on`, assignee — ✅ API landed early; UI outstanding | L |
| 2.12 | Sorting and pagination (server-side) — ✅ API landed early; UI outstanding | M |
| 2.13 | Default view: `open AND waiting_on = us`, oldest first — ✅ API landed early; UI outstanding | S |
| 2.14 | Ticket detail: thread view, customer context, metadata sidebar — ✅ API landed early; UI outstanding | L |
| 2.15 | Reply composer (persists a message; sending arrives in Phase 6) | M |
| 2.16 | **State-machine tests** for the transition service: every legal transition, and rejection of every illegal one | M |

> The **read side of 2.11–2.14 already exists** — `GET /api/tickets` serves every
> filter, sort, and page these need, and `GET /api/tickets/:number` serves the
> thread, the cross-ticket customer history, and the closed-ticket cross-link.
> What is outstanding is the UI. Do not rebuild the queries.
>
> `waiting_on` is what makes the list usable. Without it every live ticket looks
> identical and the queue stops telling anyone what to work on — see the PRD.
>
> Assignment (2.7) and the assignee filter (2.11) are only testable against the
> seeded agent users from 1.16, and only meaningfully so if the 2.1 switcher can
> act as more than one of them. With a single actor they look like they work and
> prove nothing.
>
> 2.16 covers the single most test-worthy unit in the system. The lifecycle has
> reopen paths, a terminal state, and cross-linking — the kind of logic that
> stays correct only if illegal transitions are asserted against, not just legal
> ones.
>
> **2.9 was built and then cut.** The 7-day auto-resolve and 14-day auto-close
> shipped, ran, and were removed during Phase 3. A queue that tidies itself
> reports a smaller backlog than the one that exists, and the ticket it tidied
> away is the one nobody got to. Every transition is now a person's, and the
> `transition-service` tests assert that no sweep can reappear without the
> assertion failing.
>
> What that gives up is a bound on how long a ticket can sit in `open` or
> `resolved`. Nothing collects that debt now — the queue view and ageing are
> what surface it. If the team later wants a limit, the thing to reach for is a
> *report* of stale tickets, not a transition that hides them.

**Exit criteria:** with no login, an agent can open the app, work the seeded
queue, and triage, reply to, and resolve a ticket end to end — with the reply and
the audit entry attributed to a real seeded agent.

---

## Phase 3 — Authentication

**Goal:** real sessions, real route protection.

| # | Task | Size |
|---|---|---|
| 3.1 | argon2id hashing helpers | S |
| 3.2 | Password policy: 12+ chars, breach check (`zxcvbn` / HIBP k-anonymity) | M |
| 3.3 | `express-session` + `connect-pg-simple`; `httpOnly`, `secure`, `SameSite=Lax` | M |
| 3.4 | **Session ID regeneration on login** (session fixation) | S |
| 3.5 | Idle timeout with rolling renewal + hard absolute lifetime | S |
| 3.6 | **Sessions queryable and deletable by user ID** | M |
| 3.7 | Login / logout routes; generic error; **hash even on unknown email** | M |
| 3.8 | Rate limiting per account *and* per IP, exponential backoff | M |
| 3.9 | CSRF tokens on state-changing requests | M |
| 3.10 | `requireAuth` / `requireAdmin` middleware | S |
| 3.11 | Login UI, session-aware routing, global 401 handling | M |
| 3.12 | **Auth integration tests**: session regeneration on login, revocation on deactivation, rate-limit backoff, no user enumeration by timing | M |
| 3.13 | **Retire the acting-user seam** — call sites move to `req.session.userId`; the header and the UI switcher are deleted | S |

> 3.4, 3.6, and 3.7 each look like details and each is a real vulnerability if
> skipped: session fixation, un-revocable access, and account enumeration by
> response timing. 3.12 exists because all three fail *silently* — the app works
> perfectly with every one of them broken.
>
> 3.10 has more surface than it would have had before the reorder: every Phase 2
> route was written without auth. Keep them mounted as one block in `app.ts` so
> this stays a single wrapping rather than a sweep across files.
>
> 3.13 is the task that makes this phase real. `getActingUser` must be **deleted,
> not left in place behind a flag** — a dev-only impersonation header that
> survives into a codebase with real sessions is a backdoor, not a convenience.
> `grep -rn "acting-user" apps` returning nothing is the check.

**Exit criteria:** every route except `/api/health` requires a session, and the
acting-user seam no longer exists.

---

## Phase 4 — User management

**Goal:** admins provision and deprovision agents, replacing the seeded accounts.

> **Deferred — nothing here is built yet.** After Phase 3 the AI summaries were
> prioritised instead, and tasks 5.1, 5.2 and 5.9 shipped ahead of this phase.
> This is the reorder the Critical path section below already anticipated:
> Phase 4 is the one genuinely movable block, because ticket work depends on
> users *existing*, not on users being *manageable*, and the 1.16 seeded agents
> supply that.
>
> The cost is the one named under 4.4–4.5 either way: one-time passwords in the
> admin UI, or Gmail send pulled forward. Deferring does not change that
> decision, it only postpones it.

| # | Task | Size |
|---|---|---|
| 4.1 | Admin CRUD: create user, assign role, edit, deactivate | M |
| 4.2 | Role enforcement across all routes; authorization matrix documented | M |
| 4.3 | **Deactivation deletes all sessions for that user** | S |
| 4.4 | Invite tokens: random, **stored hashed**, single-use, 72h TTL | M |
| 4.5 | Reset tokens: same rules, 1h TTL, generic response | M |
| 4.6 | Reset/deactivate invalidates all existing sessions | S |
| 4.7 | Set-password and reset-password UI | M |
| 4.8 | Admin user-management screen | M |

> **Email dependency:** 4.4–4.5 deliver tokens by email, which does not exist
> until Phase 6. Ship Phase 4 with a one-time password displayed once in the
> admin UI, then switch to emailed links in Phase 6 (task 6.10). Alternatively
> pull Gmail send (6.8) forward — it is small and has no prerequisites beyond
> the P-track. Decide now, not when Phase 4 is code-complete.
>
> Role enforcement (4.2) is a sweep across routes written in Phases 2 and 3.
> Because ticket work now precedes auth, most of those routes were written with
> no authorization at all — apply `requireAdmin` as part of 3.10 so this stays an
> audit rather than a second retrofit.

**Exit criteria:** an admin can onboard and offboard an agent; offboarding cuts access immediately.

---

## Phase 5 — AI features

**Goal:** classification, summaries, and grounded draft replies.

### 5a · Foundations

| # | Task | Size |
|---|---|---|
| 5.1 | `Job` queue worker: `FOR UPDATE SKIP LOCKED`, retries, backoff, dead-letter — ✅ landed early, ahead of Phase 4 | M |
| 5.2 | Anthropic client wrapper: retries, timeouts, error taxonomy — ✅ landed early | M |
| 5.3 | **Knowledge base**: model, admin CRUD, markdown editor | L |
| 5.4 | **Measure total KB tokens** (`messages.countTokens`) | S |
| 5.5 | Prompt assembly: system → KB → ticket body, cache breakpoint after the KB | M |
| 5.6 | **Assert `cache_read_input_tokens > 0`** in an integration test | S |

> The KB is not a separate phase but the PRD requires replies to be grounded in
> it, so it has to land here — drafts without it are ungrounded by definition.
> 5.4 is a branch point: under ~200k tokens the whole KB ships in the cached
> prompt and there is no retrieval layer; above it, add `pgvector` and chunking,
> which is a material addition to this phase.
>
> **5.1, 5.2 and 5.9 shipped ahead of Phase 4** — the summaries were prioritised
> directly after Phase 3. What that bought is the foundation the rest of this
> phase and all of Phase 6 stand on: a drained job queue and one place where
> Anthropic failures are classified as retry-or-give-up.
>
> What it deliberately left alone: there is no knowledge base, so there is
> nothing cacheable and **no cache breakpoint yet** — 5.5 and 5.6 are still
> open, and the summarize prompt is already ordered stable-first so adding one
> does not reshuffle the prefix. The classifier (5.7) is not built, so
> `classificationState` is still `PENDING` on every ticket. And summaries are
> triggered by hand: nothing enqueues one automatically, because nothing creates
> tickets until Phase 6.

### 5b · Classification & summaries

| # | Task | Size |
|---|---|---|
| 5.7 | Classifier job: structured output, category enum + confidence, `effort: low` | M |
| 5.8 | `classification_state = failed` never blocks the agent | S |
| 5.9 | Summarization job, `effort: low` — ✅ landed early, with an on-demand trigger | M |
| 5.10 | Store agent category corrections as labeled eval data | M |

### 5c · Suggested replies

| # | Task | Size |
|---|---|---|
| 5.11 | Draft job, `effort: high`, KB-grounded | L |
| 5.12 | **Grounding gate** — no supporting KB content → withhold the draft, flag for research | M |
| 5.13 | Prompt-injection delimiting of the customer email body | M |
| 5.14 | Draft UI: show, edit, use, discard; cite source KB documents | L |
| 5.15 | **Postgres: AI-drafted / edited-before-send flags on every message** — the durable record the dashboard queries | M |
| 5.16 | Spans per Anthropic call: model, effort, tokens, cache reads, latency | M |
| 5.17 | **OTel metrics: draft accepted / edited / rejected** — the telemetry view | M |
| 5.18 | **Classification eval** over the 1.17 seed corpus; assert ≥85% against labeled fixtures | M |

> 5.15 and 5.17 are deliberately separate and both required. **5.15 is the
> source of truth** — flags on the message row in Postgres, which is what the
> Phase 7 dashboard queries. **5.17 is telemetry** — OTel metrics out over OTLP,
> for watching a run in progress. Build only 5.17 and 7.4 has nothing to render;
> the dashboard queries Postgres, not a metrics backend.
>
> Both ship with the first draft, not later. Acceptance rate is the primary
> success measure for the product and — unlike latency or error rate — there is
> no log to reconstruct it from after the fact.

**Exit criteria:** a seeded ticket gets a category, a summary, and a cited draft; acceptance is measurable.

---

## Phase 6 — Email integration

**Goal:** real mail in, real replies out.

**Prerequisite:** P.1–P.4 complete (Gmail API enabled, refresh token in hand).

### 6a · Inbound polling

| # | Task | Size |
|---|---|---|
| 6.1 | Gmail client: OAuth refresh-token flow, token refresh handling | M |
| 6.2 | Polling loop in the worker: `users.history.list` from stored `historyId`, every 30–60s | M |
| 6.3 | **`historyId` expiry → bounded full resync** rather than a crash | M |
| 6.4 | Message parsing: headers, body (text + HTML), encodings | M |
| 6.5 | **Idempotency on Gmail message ID** — an overlapping poll must not double-create | M |
| 6.6 | Ticket/customer creation; **map replies to tickets via `threadId`** | M |
| 6.7 | Attachments → the 1.18 storage driver; auto-responder and loop suppression; spam drop | M |

### 6b · Outbound

| # | Task | Size |
|---|---|---|
| 6.8 | Gmail send with `threadId` set so replies land in the existing conversation | M |
| 6.9 | Wire the Phase 2 composer to actually send; set `waiting_on = customer` | M |
| 6.10 | Switch invites and password resets to emailed links | S |
| 6.11 | Quota and 429 handling; surface persistent send failures to the agent | M |
| 6.12 | **Dead-man's switch: no inbound email polled in N hours** | M |
| 6.13 | **Fixture-driven tests**: `historyId` expiry → resync, re-poll is idempotent, auto-responder headers create no ticket | M |

> Threading is `threadId` — one field, no header parsing, no per-mail-client
> edge cases. The real risks in this phase are quieter: an unhandled
> `historyId` expiry (6.3) silently stops ingestion, and a missing idempotency
> key (6.5) duplicates tickets on retry. Both fail without an error, which is
> exactly why 6.13 tests them against fixtures rather than waiting to observe
> them in production.
>
> Attachments (6.7) go through the 1.18 storage abstraction, never `node:fs`
> at the call site — the key validation lives in one place for a reason.

**Exit criteria:** mail to the support address becomes a threaded ticket; replies land in the customer's existing conversation.

---

## Phase 7 — Dashboard

**Goal:** visibility into volume, mix, and AI adoption.

| # | Task | Size |
|---|---|---|
| 7.1 | Aggregate queries: volume, backlog, response time, resolution time — ✅ volume and backlog landed at `/api/stats`; response and resolution time outstanding | M |
| 7.2 | Category breakdown over time — ✅ point-in-time breakdown landed; the time series is outstanding | M |
| 7.3 | Dashboard UI with date-range selection | L |
| 7.4 | AI adoption panel: acceptance rate, edit rate, drafts withheld — queried from the **5.15 Postgres flags**, not from OTel metrics — ✅ API landed; UI outstanding | M |
| 7.5 | Audit log viewer (admin only) | M |
| 7.6 | Index review — dashboard aggregates are the queries most likely to go slow | M |

> Part of this phase landed early alongside the ticket read endpoints:
> `GET /api/stats` already derives acceptance and edit rates from the per-message
> flags, which is what proves the 5.15 design works. What is missing is anything
> time-bucketed, and the entire UI.

**Exit criteria:** an admin can answer "is this working?" without opening a SQL client.

---

## Phase 8 — Polish & hardening

**Goal:** trustworthy enough to put real customer mail through.

### 8a · Validation & error handling

| # | Task | Size |
|---|---|---|
| 8.1 | Zod validation sweep across every route boundary | M |
| 8.2 | Consistent API error shape; no stack traces past the error middleware | M |
| 8.3 | Frontend error boundaries, retry affordances, empty and loading states | M |
| 8.4 | Anthropic and Gmail outage degradation paths | M |

### 8b · Operability

| # | Task | Size |
|---|---|---|
| 8.5 | OpenTelemetry wiring in both processes; console exporter by default, OTLP endpoint when set | M |
| 8.6 | Surface the dead-man's switch (6.12) in the SPA — the polling loop dying is the one failure nobody notices | S |
| 8.7 | `pg_dump` backup and a **rehearsed restore** — an untested restore is not a backup | M |

> Every process on one machine means every process shares one failure: the
> machine. 8.7 is the whole disaster-recovery story, which is why rehearsing it
> is a task and not a note.

### 8c · Launch readiness

| # | Task | Size |
|---|---|---|
| 8.8 | Security review: authz matrix, CSRF, rate limits, session revocation | L |
| 8.9 | Runbook: polling stalled, refresh token revoked, Anthropic down, bad drafts | M |
| 8.10 | Implement the retention and PII policy decided at **P.5** | M |
| 8.11 | Agent onboarding docs and training | M |

**Exit criteria:** a restore has been rehearsed from a real dump; the dead-man's
switch has been proven to fire; and an agent who did not build it can work a
real ticket end to end from the runbook.

---

## Critical path

```
P.1–P.4 Gmail setup ──────────────────────────────────┐
P.5 retention policy ─────────────────────────────────┼──────────────┐
                                                      ▼              ▼
1.x setup ──► 2.x tickets ──► 3.x auth ──► 4.x users ──► 5.x AI ──► 6.x email ──► 7.x dashboard ──► 8.x polish
                   │              │                        │
            2.1 acting-user ──────┘                   5.1 job queue
              seam (retired                          (used by 5.x and 6.x)
                  at 3.13)
```

Serial, with one exception taken. No phase waits on infrastructure, DNS, or a
third-party provisioning step — polling removed all three, and there is nothing
to deploy.

**Phase 4 is the one genuinely movable block, and it has been moved.** Ticket
work depends on users existing, not on users being *manageable*, which is why it
sat here. After Phase 3, tasks 5.1, 5.2 and 5.9 were built instead, and Phase 4
now runs after them. The seeded agents from 1.16 are what make that safe: every
author, assignee, and audit actor still resolves to a real user.

The order that must **not** be revisited is Phases 2 and 3 — see below. Moving
Phase 4 costs nothing; moving auth costs a longer window in which a writable
unauthenticated CRM holds customer data.

**Phases 2 and 3 are the one pair that must not be reordered again.** Auth was
already moved after ticket work once; the acting-user seam is what pays for that,
and it is only safe because 3.13 removes it. Pushing auth back further extends
the window in which a writable unauthenticated CRM holds customer data.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Support inbox is a Google Group | Reshapes Phase 6 | Verify at P.1, before anything else |
| `historyId` expiry unhandled | Ingestion stops silently | Bounded full resync (6.3) + dead-man's switch (6.12) |
| Missing idempotency on poll | Duplicate tickets | Gmail message ID as idempotency key (6.5) |
| Refresh token revoked | Ingestion stops | Dead-man's switch catches it (6.12); escalation path is domain-wide delegation |
| A second worker started by hand | Duplicate tickets | One `pnpm dev`, one worker; the poller is not concurrency-safe |
| **Acting-user seam outlives Phase 2** | An impersonation header in a codebase with real sessions is a backdoor | 3.13 deletes it; it refuses to construct when `NODE_ENV=production` |
| **Whole ticket surface written before auth** | 3.10 becomes a sweep instead of a wrapping | Mount every route as one block in `app.ts`; route through the 2.1 seam, never an ad-hoc user lookup |
| Single seeded actor through Phase 2 | Assignment and attribution look correct but are untested | Seed agent users at 1.16; make the 2.1 switcher able to act as each |
| Authorization retrofitted at 4.2 | Sweep across routes already written | Apply `requireAdmin` during 3.10, while the routes are already being touched |
| KB exceeds context budget | Adds retrieval to Phase 5 | Measure at 5.4 before planning the phase |
| Prompt cache silently missing | Cost multiple, not an error | Assert `cache_read_input_tokens > 0` (5.6) |
| Adoption metric added late | Success is unmeasurable | 5.15 / 5.17 ship with the first draft |
| Weak seed fixtures | Phases 2 and 5 built on unrealistic data | Invest in 1.17 early; it doubles as the AI eval set |
| Untested lifecycle transitions | Illegal state changes ship unnoticed | State-machine tests at 2.16 |
| Attachment keys built from Gmail IDs reach `node:fs` unvalidated | Path traversal out of the storage root | Every key goes through the 1.18 abstraction |
| One machine, one disk | Losing it loses the tickets | Rehearsed `pg_dump` restore (8.7) |
| ~~Send volume exceeds Gmail quota~~ | Resolved — under 50/day against ~2,000/day | Still handle 429s (6.11) |

## Explicitly not in scope

Auto-send and the override window, multi-tenancy, customer-facing login,
AI-initiated actions (refunds, order lookups), and multilingual support. See the
PRD for what was removed and why.
