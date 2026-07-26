import { Router } from 'express';
import { listUsers } from '../../tickets/ticket-service.js';

/**
 * Internal users, for assignment and the assignee filter. The service selects
 * an explicit field list, so a password hash cannot reach this response even
 * if someone later adds one to the model.
 *
 * Phase 4 adds the admin-only write side behind `requireAdmin`.
 */
export const usersRouter: Router = Router();

usersRouter.get('/users', async (_req, res) => {
  res.json({ items: await listUsers() });
});
