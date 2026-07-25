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

describe('HealthIndicator', () => {
  it('shows the API version once the health check resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'ok',
            version: '9.9.9',
            uptimeSeconds: 1,
            checks: { database: 'ok' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    renderApp('/tickets');

    expect(await screen.findByText('API ok · v9.9.9')).toBeInTheDocument();
  });
});
