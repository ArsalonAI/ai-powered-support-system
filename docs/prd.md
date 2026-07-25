
## Problem

The current CRM exists to support human agents in answering user email queries for product information, refund requests, etc. however they're limited to canned answers pre-populated and have no ai-assistance for natural language responses.

## Solution

An AI-powered CRM that augments human agents by providing ai-generated responses to non-critical user queries and features to help human agents write better repsonses. 


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

## Features

- user authentication
- user management (admin only)
- receive emails and create tickets
- ticket list with filtering and sorting
- ai-powered ticket classification
- ai summaries
- ai-drafted replies grounded in the knowledge base — the agent reviews, edits
  if needed, and sends
- dashboard to view and manage all tickets

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

## Delivery Phases

Build order. Task-level detail is in [implementation-plan.md](./implementation-plan.md).

| # | Phase | Delivers |
| --- | --- | --- |
| 1 | Project setup | Scaffolding, database, Prisma schema, admin seed |
| 2 | Authentication | Login, sessions, route protection |
| 3 | Ticket CRUD | Core ticket operations, list/detail with filtering |
| 4 | User management | Admin CRUD for agents, role-based access |
| 5 | AI features | Classification, summaries, suggested replies |
| 6 | Email integration | Gmail polling → tickets, outbound replies |
| 7 | Dashboard | Stats overview, category breakdown |
| 8 | Polish & deployment | Validation, error handling, Docker |

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

## Out of Scope

Not being built, and why:

| Excluded | Reason |
| --- | --- |
| Auto-send / unsupervised replies | Removed for simplicity — every reply is reviewed by a human. Off-hours coverage is the cost. |
| Multi-tenancy | Single company, single support team. |
| Customer-facing login or portal | Customers interact solely over email. |
| AI-initiated actions (issuing refunds, order lookups) | The AI is read-only. It can explain refund *policy*, not refund *status*. |
| Multilingual support | Not in v1. |