import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../api-error.js';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound('Route not found'));
}
