import { HUMAN_LABELS } from '@support/shared';
import { useLogout, useSession } from './queries';

/**
 * Who you are signed in as, and the way out. Replaces task 2.1's agent
 * switcher, which is gone along with the header it set — the name here is now
 * a fact about the session rather than a choice in a dropdown.
 */
export function SessionMenu() {
  const { data: session } = useSession();
  const logout = useLogout();

  if (!session) return null;

  const { user } = session;

  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <div className="text-sm font-medium text-slate-900">{user.name}</div>
        <div className="text-xs text-slate-500">{HUMAN_LABELS.role[user.role]}</div>
      </div>
      <button
        type="button"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
      >
        {logout.isPending ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

/**
 * The forced-password-change flag from task 1.15, surfaced rather than
 * enforced. The set-password flow that would clear it is task 4.7, so blocking
 * the app on it now would lock the bootstrap admin out of their own system.
 */
export function MustChangePasswordBanner() {
  const { data: session } = useSession();

  if (!session?.user.mustChangePassword) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
      This account is still on its bootstrap password. Changing it arrives with user management
      (task 4.7).
    </div>
  );
}
