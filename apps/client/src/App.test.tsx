import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
 * The queue page fans out to several endpoints — health, the ticket list, and
 * the agent roster. A single blanket mock would hand each of them the same
 * payload, so responses are routed by path the way the real API does.
 */
function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const match = Object.keys(routes).find((path) => url.startsWith(`/api${path}`));
      if (!match) return Promise.reject(new Error(`Unmocked request: ${url}`));
      return Promise.resolve(
        new Response(JSON.stringify(routes[match]), {
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

describe('App routing', () => {
  it('redirects the index route to the ticket queue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument();
  });

  it('renders the dashboard route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderApp('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('renders a not-found page for an unknown route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
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
