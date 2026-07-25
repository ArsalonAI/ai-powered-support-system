import type { HealthResponse } from '@support/shared';
import { Router } from 'express';
import { env } from '../../config/env.js';
import { checkDatabase } from '../../db/prisma.js';

export const healthRouter: Router = Router();

const startedAt = Date.now();

/**
 * The one route that does not require a session — email is polled rather than
 * pushed, so there is no webhook endpoint and nothing else to expose.
 */
healthRouter.get('/health', async (_req, res) => {
  const databaseOk = await checkDatabase();

  const body: HealthResponse = {
    status: databaseOk ? 'ok' : 'degraded',
    version: env.APP_VERSION,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    checks: { database: databaseOk ? 'ok' : 'error' },
  };

  res.status(databaseOk ? 200 : 503).json(body);
});
