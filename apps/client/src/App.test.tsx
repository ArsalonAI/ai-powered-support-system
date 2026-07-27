import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { createQueryClient } from './lib/query-client';

function renderApp(initialPath: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Every page below the login route is behind the session guard (task 3.11), so
 * a rendered test is a signed-in test unless it says otherwise.
 */
const SESSION = {
  user: {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Alex Chen',
    email: 'alex@example.com',
    role: 'AGENT',
    mustChangePassword: false,
  },
  csrfToken: 'test-csrf-token',
  absoluteExpiresAt: '2099-01-01T00:00:00.000Z',
};

/**
 * The queue page fans out to several endpoints — the session, health, the
 * ticket list, and the agent roster. A single blanket mock would hand each of
 * them the same payload, so responses are routed by path the way the real API
 * does. A route may be a status code instead of a body, for the signed-out and
 * expired-session cases.
 */
function stubFetch(routes: Record<string, unknown>) {
  const withSession: Record<string, unknown> = { '/auth/me': SESSION, ...routes };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      // Longest match wins, so '/tickets/42' does not resolve to '/tickets'.
      const match = Object.keys(withSession)
        .filter((path) => url.startsWith(`/api${path}`))
        .sort((a, b) => b.length - a.length)[0];

      if (!match) return Promise.reject(new Error(`Unmocked request: ${url}`));

      const route = withSession[match];
      if (typeof route === 'number') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
            }),
            { status: route, headers: { 'content-type': 'application/json' } },
          ),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify(route), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
}

const HEALTH = { status: 'ok', version: '9.9.9', uptimeSeconds: 1, checks: { database: 'ok' } };

const EMPTY_QUEUE = {
  items: [],
  pageInfo: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 },
};

const ONE_TICKET = {
  items: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      number: 42,
      subject: 'CSV export stops at 1000 rows',
      status: 'OPEN',
      waitingOn: 'US',
      classificationState: 'DONE',
      category: 'TECHNICAL_QUESTION',
      flaggedForResearch: false,
      customer: {
        id: '22222222-2222-2222-2222-222222222222',
        email: 'dana@example.com',
        displayName: 'Dana Reyes',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
      },
      assignee: null,
      messageCount: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastInboundAt: null,
      lastOutboundAt: null,
    },
  ],
  pageInfo: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const SIGNED_IN_ROUTES = { '/health': HEALTH, '/tickets': EMPTY_QUEUE, '/users': { items: [] } };

describe('App routing', () => {
  it('redirects the index route to the ticket queue', async () => {
    stubFetch(SIGNED_IN_ROUTES);
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument();
  });

  it('renders the dashboard route', async () => {
    stubFetch(SIGNED_IN_ROUTES);
    renderApp('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('renders a not-found page for an unknown route', async () => {
    stubFetch(SIGNED_IN_ROUTES);
    renderApp('/nope');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('the ticket queue', () => {
  it('renders a ticket row linking to its detail view', async () => {
    stubFetch({ '/health': HEALTH, '/tickets': ONE_TICKET, '/users': { items: [] } });
    renderApp('/tickets');

    const link = await screen.findByRole('link', { name: 'CSV export stops at 1000 rows' });
    expect(link).toHaveAttribute('href', '/tickets/42');
    expect(screen.getByText('Dana Reyes')).toBeInTheDocument();
  });

  it('describes the default view rather than leaving it implicit', async () => {
    stubFetch({ '/health': HEALTH, '/tickets': ONE_TICKET, '/users': { items: [] } });
    renderApp('/tickets');

    expect(await screen.findByText(/waiting on us, oldest first/i)).toBeInTheDocument();
  });

  it('says so plainly when nothing matches', async () => {
    stubFetch({ '/health': HEALTH, '/tickets': EMPTY_QUEUE, '/users': { items: [] } });
    renderApp('/tickets');

    expect(await screen.findByText('No tickets match these filters.')).toBeInTheDocument();
  });
});

describe('HealthIndicator', () => {
  it('shows the API version once the health check resolves', async () => {
    stubFetch({ '/health': HEALTH, '/tickets': EMPTY_QUEUE, '/users': { items: [] } });

    renderApp('/tickets');

    expect(await screen.findByText('API ok · v9.9.9')).toBeInTheDocument();
  });
});

/**
 * Task 3.11. The guard is a redirect rather than a security boundary — the API
 * refuses these routes on its own — but without it a signed-out agent gets an
 * empty queue full of failed requests and no indication of why.
 */
describe('the session guard', () => {
  it('sends a signed-out visitor to the login page', async () => {
    stubFetch({ '/auth/me': 401 });
    renderApp('/tickets');

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs in and lands on the page the visitor was trying to reach', async () => {
    stubFetch({ '/auth/me': 401, '/auth/login': SESSION, ...SIGNED_IN_ROUTES });
    const user = userEvent.setup();
    renderApp('/dashboard');

    await user.type(await screen.findByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'harbour-lantern-thistle-9');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('shows the server’s message, and only that, when sign-in fails', async () => {
    // One message for every kind of failure. The client must not embellish it
    // into something that says whether the account exists.
    stubFetch({ '/auth/me': 401, '/auth/login': 401 });
    const user = userEvent.setup();
    renderApp('/tickets');

    await user.type(await screen.findByLabelText('Email'), 'nobody@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password-here');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Authentication required');
  });

  it('drops back to login when a session ends mid-use', async () => {
    // The absolute lifetime elapsing, or an admin deactivating the account,
    // arrives as a 401 on whatever request happens to be next. The global
    // handler in query-client.ts is what turns that into a login page rather
    // than an error banner over an empty queue.
    stubFetch({ '/auth/me': SESSION, '/health': HEALTH, '/tickets': 401, '/users': { items: [] } });
    renderApp('/tickets');

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('says the API is unreachable rather than claiming the visitor is signed out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderApp('/tickets');

    expect(await screen.findByText(/cannot reach the api/i)).toBeInTheDocument();
  });
});
