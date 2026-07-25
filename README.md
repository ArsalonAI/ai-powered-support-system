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

Specification complete; implementation not yet started. Start at
[Phase 1](docs/implementation-plan.md#phase-1--project-setup).

## License

TBD
