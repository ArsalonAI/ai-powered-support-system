import { Router } from 'express';
import { getStats } from '../../tickets/stats-service.js';

/** Phase 7 renders these; the endpoint exists now to prove they are derivable. */
export const statsRouter: Router = Router();

statsRouter.get('/stats', async (_req, res) => {
  res.json(await getStats());
});
