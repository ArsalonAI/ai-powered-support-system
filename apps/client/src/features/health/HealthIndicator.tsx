import { useHealth } from './useHealth';

/**
 * Proves the SPA → `/api` → Postgres path end to end. Phase 8 replaces this
 * with real error boundaries and degradation states.
 */
export function HealthIndicator() {
  const { data, isPending, isError } = useHealth();

  const { label, dotClass } = isPending
    ? { label: 'Checking API…', dotClass: 'bg-slate-300' }
    : isError || data?.status !== 'ok'
      ? { label: 'API unavailable', dotClass: 'bg-red-500' }
      : { label: `API ok · v${data.version}`, dotClass: 'bg-emerald-500' };

  return (
    <span className="flex items-center gap-2 text-xs text-slate-500" data-testid="health-indicator">
      <span className={`size-2 rounded-full ${dotClass}`} aria-hidden />
      {label}
    </span>
  );
}
