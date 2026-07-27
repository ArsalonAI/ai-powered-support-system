import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ApiClientError } from '../lib/api-client';
import { useLogin, useSession } from '../features/auth/queries';

/**
 * The only page reachable without a session.
 *
 * The error message is whatever the server said, which is deliberately one
 * message for every kind of failure — wrong password, unknown address, closed
 * account. Being more helpful here would tell an attacker which addresses are
 * worth guessing at.
 */
export function LoginPage() {
  const { data: session } = useSession();
  const location = useLocation();
  const login = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Where the guard bounced them from, so signing in resumes the ticket they
  // were opening rather than dropping them at the queue.
  const from = (location.state as { from?: string } | null)?.from ?? '/tickets';

  if (session) {
    return <Navigate to={from} replace />;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate({ email: email.trim(), password });
  }

  const retryAfter =
    login.error instanceof ApiClientError && login.error.status === 429
      ? 'Too many attempts. Wait a moment and try again.'
      : null;

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">Support</h1>
        <p className="mt-1 text-sm text-slate-600">Sign in to work the queue.</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </div>

          {login.isError && (
            <p role="alert" className="text-sm text-red-700">
              {retryAfter ?? (login.error as Error).message}
            </p>
          )}

          <button
            type="submit"
            disabled={login.isPending || !email || !password}
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
