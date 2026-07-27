import express, { Router, type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { apiDocsEnabled, env, isProduction } from './config/env.js';
import { logger } from './observability/logger.js';
import { errorHandler } from './http/middleware/error-handler.js';
import { notFoundHandler } from './http/middleware/not-found.js';
import { requestContext } from './http/middleware/request-context.js';
import { csrfProtection } from './auth/csrf.js';
import { requireAuth } from './auth/current-user.js';
import { sessionMiddleware } from './auth/session.js';
import { authRouter } from './http/routes/auth.js';
import { devRouter } from './http/routes/dev.js';
import { docsRouter } from './http/routes/docs.js';
import { healthRouter } from './http/routes/health.js';
import { statsRouter } from './http/routes/stats.js';
import { ticketsRouter } from './http/routes/tickets.js';
import { usersRouter } from './http/routes/users.js';

/**
 * Builds the Express app without listening, so integration tests can drive it
 * through supertest without binding a port.
 */
export function createApp(): Express {
  const app = express();

  // Exactly as many hops as there are proxies — see TRUST_PROXY_HOPS. The
  // Phase 3 per-IP rate limiter is only as correct as this number.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { requestId?: string }).requestId ?? 'unknown',
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // The one route that stays public. Everything below needs a session.
  app.use('/api', healthRouter);

  app.use(sessionMiddleware);
  // Ahead of the routers rather than inside them, so a route added later cannot
  // be state-changing and unprotected at the same time.
  app.use(csrfProtection);

  // Login is the only unauthenticated route in the API — it is what a caller
  // uses to stop being unauthenticated. Its own handlers apply `requireAuth`
  // where it belongs (logout, me, sessions).
  app.use('/api', authRouter);

  /**
   * Task 3.10 — one wrapping rather than a sweep across files. This is the
   * block the Phase 2 routers were deliberately mounted in: they were written
   * with no authorization at all and are protected here without any of them
   * being touched.
   *
   * `requireAuth` sits on the sub-router rather than on each `app.use('/api',
   * …)` line so it runs **once** per request. Repeating it per mount would put
   * the user lookup on the wire three times for a request that matches the
   * third.
   *
   * A consequence worth naming: an unknown `/api/*` path now answers 401 rather
   * than 404, because this runs before the not-found handler. That is the right
   * way round — which routes exist is not something an unauthenticated caller
   * needs to be able to map.
   */
  const protectedApi = Router();
  protectedApi.use(requireAuth);
  protectedApi.use(ticketsRouter);
  protectedApi.use(usersRouter);
  protectedApi.use(statsRouter);

  // Inside the block, not above it. The document contains no customer data, so
  // exposing it is tempting — but Phase 3's exit criterion is that every route
  // except `/api/health` needs a session, and `/api/openapi.json` is the one
  // route that hands an unauthenticated caller a complete map of every other
  // one. Leaving it public would also contradict the paragraph above: there is
  // no point answering 401 instead of 404 to keep route existence private while
  // publishing the full index two mounts earlier.
  if (apiDocsEnabled) {
    protectedApi.use(docsRouter);
  }

  // The developer dashboard prints working credentials, so it is dev-only and
  // — for the same reason as the docs — inside the block rather than in front
  // of it. `assertDevDashboardAllowed()` in server.ts fails the boot instead of
  // relying on this condition alone.
  if (!isProduction) {
    protectedApi.use(devRouter);
  }

  app.use('/api', protectedApi);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
