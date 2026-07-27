import { Navigate, Outlet, useLocation } from 'react-router';
import { useSession } from './queries';

/**
 * Task 3.11's client half of the server's `requireAuth`.
 *
 * This is a redirect, not a security boundary — every route it wraps is behind
 * a session check on the API too, and that is the one that matters. What this
 * prevents is a signed-out agent staring at an empty queue full of 401s with no
 * indication that signing in is what they need.
 */
export function RequireSession() {
  const { data: session, isPending, isError } = useSession();
  const location = useLocation();

  if (isPending) {
    // Deliberately bare. A skeleton of the queue would flash the shape of an
    // app the visitor may not be entitled to see.
    return (
      <div className="flex min-h-full items-center justify-center p-16 text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  // A network failure is not a sign-out. Sending someone to a login page they
  // then cannot use would misreport the problem.
  if (isError) {
    return (
      <div className="flex min-h-full items-center justify-center p-16 text-sm text-slate-600">
        Cannot reach the API. Check that the server is running, then reload.
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
}
