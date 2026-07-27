import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { SEED_AGENT_PASSWORD } from '../../config/seed-credentials.js';
import { env, isProduction } from '../../config/env.js';
import { DEV_DASHBOARD_PATH } from '../routes/dev.js';
import { registry } from './registry.js';

/**
 * The document is generated from the same Zod schemas the server validates
 * against, so it cannot describe an endpoint that does not exist or a field
 * shape the code does not actually return.
 */
// `openapi3-ts` is declared explicitly rather than leaned on transitively:
// the generator's return type comes from it, and TypeScript cannot name a
// type it can only reach through another package's dependency tree.
let cached: OpenAPIObject | undefined;

export function openApiDocument(): OpenAPIObject {
  const document = (cached ??= new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Support API',
      version: env.APP_VERSION,
      description: [
        'Internal API for the email support CRM.',
        '',
        '### Signing in',
        '',
        '**Every route except `/health` and `/auth/login` requires a session.** You are',
        'already signed in if you can read this — these docs sit behind the same check.',
        '',
        'Session auth is a cookie, so "Try it out" works with no extra setup for reads.',
        'For anything that changes state you also need the CSRF token: call',
        '`GET /auth/me`, copy `csrfToken` from the response, and paste it into the',
        '`x-csrf-token` field on the request. A missing or stale token is a 403, not a 401.',
        '',
        ...(isProduction
          ? []
          : [
              '### Development',
              '',
              `- [**Developer dashboard**](/api${DEV_DASHBOARD_PATH}) — seeded accounts and their`,
              '  passwords, test coverage, and links to everything else',
              `- Seeded agents sign in with \`${SEED_AGENT_PASSWORD}\`; see [\`GET /users\`](/api/users)`,
              '  for the addresses, or the dashboard above',
              '',
            ]),
        '### The app',
        '',
        '- [Ticket queue](/tickets) — the default agent view',
        '- [Dashboard](/dashboard)',
        '',
        '### This API',
        '',
        '- [Raw OpenAPI document](/api/openapi.json)',
        '- [Health](/api/health) — the one route that needs no session',
        '',
        'App links are relative, so they resolve only when these docs are opened through',
        'the SPA origin — **http://localhost:5173/api/docs**. Opened directly on the API',
        'port there is no SPA to link to. That is the same-origin rule the whole app is',
        'built on, not an oversight.',
        '',
        'This documentation UI is disabled in production.',
      ].join('\n'),
    },
    servers: [{ url: '/api', description: 'Same-origin: the SPA and the API share one origin' }],
    tags: [
      { name: 'Tickets', description: 'The ticket queue and thread view' },
      { name: 'Users', description: 'Internal agents and admins' },
      { name: 'System', description: 'Health and aggregate figures' },
    ],
  }));

  return document;
}
