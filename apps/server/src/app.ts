import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { apiDocsEnabled, env } from './config/env.js';
import { logger } from './observability/logger.js';
import { errorHandler } from './http/middleware/error-handler.js';
import { notFoundHandler } from './http/middleware/not-found.js';
import { requestContext } from './http/middleware/request-context.js';
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
  // Phase 2 per-IP rate limiter is only as correct as this number.
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

  app.use('/api', healthRouter);

  // Phase 2 wraps everything below this line in `requireAuth`; `/api/health`
  // above it is the one route that stays public.
  app.use('/api', ticketsRouter);
  app.use('/api', usersRouter);
  app.use('/api', statsRouter);

  if (apiDocsEnabled) {
    app.use('/api', docsRouter);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
