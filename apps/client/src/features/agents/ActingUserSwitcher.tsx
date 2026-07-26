import { useSyncExternalStore } from 'react';
import { getActingUserId, setActingUserId, subscribeToActingUser } from '../../lib/acting-user';
import { useAgents } from '../tickets/queries';

/**
 * TEMPORARY — the visible half of task 2.1's seam, deleted at 3.13 and replaced
 * by whoever is logged in.
 *
 * It is a real chooser rather than a fixed default on purpose: with a single
 * actor, assignment and author attribution look correct and prove nothing. The
 * plan calls that out as a risk against the seeded agents from task 1.16.
 */
export function ActingUserSwitcher() {
  const actingUserId = useSyncExternalStore(subscribeToActingUser, getActingUserId, () => null);
  const { data: agents } = useAgents();

  if (!agents || agents.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-500" title="Stands in for a login until Phase 3">
        Acting as
      </span>
      <select
        className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-sm font-medium text-slate-900"
        value={actingUserId ?? ''}
        onChange={(event) => setActingUserId(event.target.value || null)}
        aria-label="Acting as"
      >
        <option value="">Default agent</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
            {agent.role === 'ADMIN' ? ' (admin)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
