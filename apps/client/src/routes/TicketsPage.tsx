import { PagePlaceholder } from '../components/PagePlaceholder';

export function TicketsPage() {
  return (
    <PagePlaceholder title="Tickets" phase="Phase 2 — Ticket CRUD">
      The queue lands here: filter by status, category, waiting-on, and assignee, defaulting to open
      tickets waiting on us, oldest first.
    </PagePlaceholder>
  );
}
