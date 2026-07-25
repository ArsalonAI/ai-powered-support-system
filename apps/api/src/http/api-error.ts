import type { ApiErrorCode, FieldIssue } from '@support/shared';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ILLEGAL_TRANSITION: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
};

/**
 * The only error type route handlers should throw. Anything else reaching the
 * error middleware is treated as an unexpected 500 and its message is not
 * shown to the client.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly issues: FieldIssue[] | undefined;
  /** `false` means "do not show this message to a user" — used for unexpected errors. */
  readonly expose: boolean;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { issues?: FieldIssue[]; cause?: unknown; expose?: boolean } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.issues = options.issues;
    this.expose = options.expose ?? true;
  }

  static badRequest(message: string): ApiError {
    return new ApiError('BAD_REQUEST', message);
  }

  static unauthenticated(message = 'Authentication required'): ApiError {
    return new ApiError('UNAUTHENTICATED', message);
  }

  static forbidden(message = 'You do not have access to this resource'): ApiError {
    return new ApiError('FORBIDDEN', message);
  }

  static notFound(message = 'Not found'): ApiError {
    return new ApiError('NOT_FOUND', message);
  }

  static conflict(message: string): ApiError {
    return new ApiError('CONFLICT', message);
  }

  static internal(message = 'Something went wrong', cause?: unknown): ApiError {
    return new ApiError('INTERNAL', message, { cause, expose: false });
  }
}
