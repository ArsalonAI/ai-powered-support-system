import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates a client-visible error, a log line, and (from 8.10) an OTel trace. */
      requestId: string;
    }
  }
}

/**
 * Trusts an inbound `x-request-id` only for correlation, never for anything
 * security-relevant, and always echoes one back.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  req.requestId = inbound && inbound.length <= 200 ? inbound : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
