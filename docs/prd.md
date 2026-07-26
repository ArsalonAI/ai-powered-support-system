# AI-Powered Support System — Product Requirements

See [tech-stack.md](./tech-stack.md) for stack decisions and
[implementation-plan.md](./implementation-plan.md) for build sequencing.

## Problem

The current CRM exists to support human agents answering customer email queries
— product information, refund requests, and general questions. Agents are
limited to pre-populated canned answers, with no AI assistance for composing
natural-language responses.

## Solution

An AI-powered CRM that augments human agents with AI-drafted replies grounded in
a knowledge base, plus classification and summarization to speed triage. The AI
drafts; a human always reviews and sends.

## Scope

User authentication and admin-managed accounts; email ingestion into tickets;
a filterable ticket list and detail view; AI classification, summarization, and
grounded draft replies; and a dashboard over volume, category mix, and AI
adoption. Everything below specifies these in detail.

## Users & Roles

Internal users only. Customers never log in — they interact solely over email.

Two roles:

| Capability | Agent | Admin |
| --- | --- | --- |
| View ticket list and dashboard | ✅ | ✅ |
| Read, claim, and reply to tickets | ✅ | ✅ |
| Use AI summaries, suggestions, and drafts | ✅ | ✅ |
| Correct an AI classification | ✅ | ✅ |
| Resolve, close, and reopen tickets | ✅ | ✅ |
| Create, deactivate, and reset users | ❌ | ✅ |
| Manage knowledge base content | ❌ | ✅ |
| View the audit log | ❌ | ✅ |

Notes:

- Admin is a strict superset of Agent — an admin is a working agent with extra
  privileges, not a separate persona.
- There is no self-service signup. Admins provision all accounts.
- Deactivation, not deletion: a departed user's account is disabled, but their
  name stays attached to every reply they sent, for audit integrity.
- **Every outbound message is sent by a named human.** The AI never sends. Each
  message records whether it was AI-drafted and whether the agent edited the
  draft before sending — that pair is the accept/edit/reject signal the success
  metrics depend on, and it cannot be reconstructed later.

### What an agent's shift looks like

An agent opens the ticket list, which defaults to `open AND waiting_on = us`,
oldest first — everything that needs a human, in the order it should be handled.
They open the top ticket. The detail view shows the full email thread, the
customer's prior tickets, an AI summary of the conversation so far, and — if the
knowledge base supports an answer — a draft reply with citations to the
documents it drew on.

The agent reads the draft, edits or discards it, and sends. The ticket flips to
`waiting_on = customer` and drops out of the default view without anyone
resolving it. If the customer replies, it comes back. If they don't, it
auto-resolves after 7 days. The agent only resolves tickets manually when they
know the conversation is genuinely finished. Claiming a ticket is optional and
signals "I'm on this" — it never blocks anyone else.

## Customers

A customer is identified by email address. No login, no portal, no password.

Stored per customer: email address, display name (from mail headers when
present), first-seen timestamp, and their full ticket history.

**History spans tickets.** The ticket detail view shows prior tickets from the
same address, so an agent can see whether this person has written before and
about what. This is the difference between "a support inbox" and "a CRM," and it
matters most on repeat refund requests.

## Knowledge Base

The knowledge base is the sole factual source for AI-drafted replies.

- A **document** is markdown with a title, body, and last-updated timestamp.
- **Admins author and maintain it.** Agents read but do not edit.
- **Grounding is a hard requirement.** A draft's factual claims must trace to at
  least one knowledge base document, and the draft cites which documents it drew
  on so the agent can verify without leaving the ticket.
- **No supporting content means no draft.** If nothing in the knowledge base
  supports an answer, the system withholds the draft and flags the ticket for
  manual research rather than answering from the model's own knowledge. A
  confidently wrong draft is worse than no draft, because it is the path of
  least resistance for a busy agent.
- Editing a document takes effect on the next draft generated.

The rate of withheld drafts is a knowledge base coverage metric, not a failure
metric — a high rate means the knowledge base has gaps worth filling.

## Attachments

Inbound attachments are stored and downloadable from the ticket. Outbound
attachments are not in v1 — agents who need to send a file can do so from their
own mail client; the reply thread is unaffected.

## Ticket Lifecycle

### Categories

Every ticket is assigned exactly one category by the AI classifier at ingest:

| Category | Description |
| --- | --- |
| Technical question | Product functionality, troubleshooting, how-to |
| Refund request | Refunds, cancellations, billing disputes, chargebacks |
| General question | Everything else — pre-sales, policy, account, shipping |

Rules:

- `General question` is the catch-all, and therefore also where the classifier
  puts anything it is unsure about. Category drives filtering and routing only —
  a misclassification costs an agent a moment of triage, never a wrong message
  to a customer, because every reply is reviewed by a human before it is sent.
- Agents can correct a category at any time. Corrections are recorded as
  labeled training/eval data.

### Statuses

A ticket is always in exactly one of three statuses:

| Status | Meaning | Terminal |
| --- | --- | --- |
| `open` | Live. Anything not yet settled — newly received, being worked, or sent and awaiting the customer | No |
| `resolved` | Answered and believed complete, but still reopenable by a customer reply | No |
| `closed` | Final. No further activity will land on this ticket | Yes |

### Sub-state fields

`open` deliberately spans ingest through awaiting-reply, so the detail an agent
needs for triage lives in fields alongside the status rather than in the status
itself. Without these, every live ticket looks identical in the list and the
queue becomes unworkable:

| Field | Values | Purpose |
| --- | --- | --- |
| `classification_state` | `pending` / `done` / `failed` | Whether the classifier has run; `failed` surfaces a manual-triage badge |
| `waiting_on` | `us` / `customer` | The single most important triage signal — separates "needs a reply" from "ball is in their court" |

The default ticket list view is `status = open AND waiting_on = us`, sorted
oldest first.

### Transitions

```
   inbound email
        │
        ▼
   ┌─────────┐   agent/admin resolves    ┌──────────┐   14 days    ┌────────┐
   │  open   │ ───────────────────────►  │ resolved │ ───────────► │ closed │
   │         │   (or 7d customer         │          │  no reply    │        │
   │         │    silence)               │          │              │        │
   └─────────┘ ◄───────────────────────  └──────────┘              └────────┘
        ▲          customer replies                                     │
        │                                                               │
        └───────── new ticket, cross-linked ◄──── customer replies ─────┘
```

Rules:

- **Ingest.** A new email creates an `open` ticket with
  `classification_state = pending` and `waiting_on = us`. Classification never
  gates visibility — the ticket is workable the moment it exists, and a
  classifier failure sets `failed` rather than blocking the agent.
- **Drafting happens inside `open`.** After classification, the system generates
  a suggested reply grounded in the knowledge base and attaches it to the
  ticket. Nothing is sent. If retrieval finds no supporting document, the draft
  is withheld and the ticket is flagged for manual research rather than
  answered from the model's own knowledge.
- **A reply is sent only when an agent sends it.** Sending records the author,
  whether the message started as an AI draft, and whether it was edited. It
  sets `waiting_on = customer` and leaves the ticket `open`.
- **A customer reply** lands on the existing ticket via Gmail `threadId`. It
  sets `waiting_on = us` and, if the ticket was `resolved`, returns it to
  `open`.
- **Auto-resolve.** An `open` ticket with `waiting_on = customer` and no reply
  for 7 days moves to `resolved`.
- **Auto-close.** A `resolved` ticket with no reply for 14 days moves to
  `closed`. This is the only path into `closed`; agents can also close manually
  for spam or duplicates.
- **`closed` is terminal.** A reply to a closed thread opens a *new* ticket,
  cross-linked to the original so the history stays traversable. Terminal means
  no new activity, not deleted — nothing is ever hard deleted.
- **Assignment is optional.** Any agent can act on any ticket; claiming sets an
  assignee for coordination only and never restricts access, since the team is
  small enough that hard ownership adds more friction than it removes.

### What does not become a ticket

- **Auto-responders** — out-of-office replies, delivery receipts, and list mail,
  detected via `Auto-Submitted`, `Precedence: bulk`, and `List-Id` headers. They
  neither create tickets nor reopen resolved ones. Without this, a customer's
  vacation responder can bounce a resolved ticket back open indefinitely.
- **Mail from the support address itself** — loop prevention.
- **Obvious spam** is dropped silently. Borderline mail becomes a ticket for an
  agent to close; false negatives cost a click, false positives lose a customer.

## Success Metrics

The system exists to make a small team faster without lowering answer quality.
These are how that gets measured.

| Metric | Definition | Target | Type |
| --- | --- | --- | --- |
| **First-response time** | Inbound message setting `waiting_on = us` → first outbound human reply, counted in business hours | **< 4 business hours** | Launch gate |
| **Draft acceptance rate** | Sent messages that began as an AI draft, as a share of all sent replies | ≥ 50% by day 90 | Primary |
| **Draft edit rate** | Accepted drafts materially edited before sending | Watch — a high rate means drafts are close but not trusted | Watch |
| **Drafts withheld** | Tickets where no draft was generated for lack of grounding | Watch — this measures knowledge base coverage, not AI quality | Watch |
| **Classification accuracy** | Classifier output vs. agent corrections | ≥ 85% | Watch |
| **Resolution time** | Ticket creation → first `resolved` | Baseline before launch, then track | Watch |

Definitions that matter for measurement:

- **Business hours** are configurable; overnight and weekend arrivals do not
  accrue against first-response time. Auto-send was removed, so nothing responds
  outside staffed hours by design.
- **First response** counts only human outbound messages. A ticket that
  auto-resolves without a reply has no first-response time.
- Acceptance rate is derived from the per-message AI-drafted/edited flags
  described under Users & Roles. It cannot be reconstructed after the fact, so
  those flags ship with the first draft feature.

## Non-Functional Requirements

| Dimension | Value |
| --- | --- |
| Ticket volume | Under 50/day, peak ~150/day |
| Support team | 1–3 agents |
| First-response target | Under 4 business hours |
| Outbound send quota | ~2,000/day (Google Workspace) — over 10× headroom against ~150 peak tickets/day |
| Ingest latency | 30–60 seconds (polling interval); acceptable given human review of every reply |
| Knowledge base size | Expected small; measured empirically before the AI phase, since it determines whether retrieval is needed at all |
| Browser support | Current Chrome, Safari, Firefox, Edge. Desktop only — no mobile layout in v1 |
| Deployment | None. The system runs locally on one machine — no cloud account, no container image, no CI |
| Availability | Business hours matter; no formal uptime SLA. Ingestion is resumable, so a brief outage delays tickets rather than losing them |
| Data retention | Not yet decided — see Open Questions |

These figures justify several architecture decisions in
[tech-stack.md](./tech-stack.md): running on one machine, the single worker
process, the plain database-backed job table, and shipping the knowledge base
inside a cached prompt rather than standing up a vector store. If volume grows
past roughly 10× these numbers, revisit all four.

## Delivery Phases

Build order. Task-level detail is in [implementation-plan.md](./implementation-plan.md).

| # | Phase | Delivers |
| --- | --- | --- |
| 1 | Project setup | Scaffolding, database, Prisma schema, admin seed |
| 2 | Ticket CRUD | Core ticket operations, list/detail with filtering |
| 3 | Authentication | Login, sessions, route protection |
| 4 | User management | Admin CRUD for agents, role-based access |
| 5 | AI features | Classification, summaries, suggested replies |
| 6 | Email integration | Gmail polling → tickets, outbound replies |
| 7 | Dashboard | Stats overview, category breakdown |
| 8 | Polish & hardening | Validation, error handling, backup/restore, runbook |

The domain model and AI are built against seeded tickets; email connects last.
Two consequences worth stating in the spec rather than discovering in the build:

- **Seed fixtures are a deliverable, not scaffolding.** Nothing creates tickets
  until Phase 6, so the ticket and AI phases are built and evaluated entirely
  against seeded data. That same corpus becomes the AI eval set. Seed agent
  users too, not just an admin — assignment and author attribution have nothing
  to point at otherwise.
- **User invites and password resets need email**, which arrives in Phase 6.
  Phase 4 therefore ships with a one-time password shown once in the admin UI,
  and switches to emailed links once outbound send exists.
- **Ticket work precedes authentication**, so the queue can be driven against the
  seeded corpus rather than built blind behind a login that does not exist yet.
  The consequence is that **the system is unauthenticated until Phase 3**, and
  during Phase 2 it is writable by anyone who can reach it. Replies, assignments,
  and audit entries are still attributed to a real seeded agent — the roles and
  attribution rules above are never relaxed, only the login is deferred.

## Out of Scope

Not being built, and why:

| Excluded | Reason |
| --- | --- |
| Auto-send / unsupervised replies | Removed for simplicity — every reply is reviewed by a human. Off-hours coverage is the cost. |
| Outbound attachments | Inbound only in v1. Agents needing to send a file can use their own mail client. |
| Multi-tenancy | Single company, single support team. |
| Customer-facing login or portal | Customers interact solely over email. |
| AI-initiated actions (issuing refunds, order lookups) | The AI is read-only. It can explain refund *policy*, not refund *status*. |
| Multilingual support | Not in v1. |
| Mobile layout | Desktop only in v1. |
| Cloud deployment, containers, CI | Not in v1 — it runs locally on one machine. A later revision may take this up; the architecture does not preclude it. |

## Open Questions

- **Data retention and PII policy.** Needs a decision before launch; it gates a
  Phase 8 implementation task.
- **Order and billing data access.** Until the AI can read it, `refund request`
  tickets can only be answered with policy, not status — which caps how useful
  drafts can be for the category most likely to need them.
- **Session idle and absolute timeout values.**
