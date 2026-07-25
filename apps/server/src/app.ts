import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './observability/logger.js';
import { errorHandler } from './http/middleware/error-handler.js';
import { notFoundHandler } from './http/middleware/not-found.js';
import { requestContext } from './http/middleware/request-context.js';
import { healthRouter } from './http/routes/health.js';

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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
