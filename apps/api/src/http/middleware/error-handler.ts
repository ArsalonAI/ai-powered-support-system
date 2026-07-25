import type { ApiErrorBody, FieldIssue } from '@support/shared';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../observability/logger.js';
import { ApiError } from '../api-error.js';

function issuesFromZod(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof ZodError) {
    return new ApiError('VALIDATION_FAILED', 'Request validation failed', {
      issues: issuesFromZod(error),
    });
  }

  // Express 5 raises this for malformed JSON bodies before any handler runs.
  if (error instanceof SyntaxError && 'body' in error) {
    return ApiError.badRequest('Malformed JSON body');
  }

  return ApiError.internal('Something went wrong', error);
}

/**
 * The single error middleware. Nothing past this point leaks a stack trace or
 * an internal message: unexpected errors are logged in full and reported to the
 * client as a bare 500 with a request ID to correlate against.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const apiError = toApiError(error);

  const log = logger.child({ requestId: req.requestId, path: req.path, method: req.method });
  if (apiError.status >= 500) {
    log.error({ err: apiError.cause ?? apiError, code: apiError.code }, apiError.message);
  } else {
    log.info({ code: apiError.code }, apiError.message);
  }

  const body: ApiErrorBody = {
    error: {
      code: apiError.code,
      message: apiError.expose ? apiError.message : 'Something went wrong',
      ...(apiError.issues ? { issues: apiError.issues } : {}),
      requestId: req.requestId,
    },
  };

  res.status(apiError.status).json(body);
}
