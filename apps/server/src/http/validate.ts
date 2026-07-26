import type { Request } from 'express';
import type { ZodType } from 'zod';
import { ApiError } from './api-error.js';

/**
 * Zod at every route boundary. Parse failures surface as VALIDATION_FAILED with
 * per-field issues rather than as a 500 from the error middleware's fallback.
 */
export function parseQuery<T>(schema: ZodType<T>, req: Request): T {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid query parameters', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export function parseParams<T>(schema: ZodType<T>, req: Request): T {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid path parameters', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export function parseBody<T>(schema: ZodType<T>, req: Request): T {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid request body', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
