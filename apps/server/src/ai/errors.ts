import Anthropic from '@anthropic-ai/sdk';

/**
 * The error taxonomy for every Anthropic call (task 5.2).
 *
 * The job queue needs exactly one bit out of a failure: **retry, or give up.**
 * Getting that bit wrong is expensive in both directions — retrying a malformed
 * request or a revoked key burns five attempts and the quota behind them to
 * arrive at the same 400, while dead-lettering a 429 throws away work that
 * would have succeeded thirty seconds later.
 *
 * So the classification lives here, once, mapped from the SDK's typed exception
 * classes rather than from message text. String-matching an error message is a
 * bug waiting for the day someone rewords it.
 */
export class AiError extends Error {
  /** Whether the queue should reschedule this job or dead-letter it. */
  readonly retryable: boolean;
  /** HTTP status, when the failure got far enough to have one. */
  readonly status: number | undefined;

  constructor(message: string, options: { retryable: boolean; status?: number; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AiError';
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

/**
 * Classify anything thrown by the SDK.
 *
 * Ordered most-specific-first: every class below extends `Anthropic.APIError`,
 * so a broad catch placed early would swallow the distinctions this function
 * exists to make.
 *
 * Note `APIConnectionError` is checked before `APIError` deliberately — in the
 * TypeScript SDK it is a *subclass* of `APIError` (unlike Python, where the two
 * are siblings), so the general case must come last.
 */
export function toAiError(error: unknown): AiError {
  // Transient: the request was fine, the far end was not.
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError('Anthropic rate limit reached', {
      retryable: true,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new AiError(`Anthropic server error (${String(error.status)})`, {
      retryable: true,
      status: error.status,
      cause: error,
    });
  }

  // Terminal: retrying reproduces the same failure. A bad key stays bad, and a
  // request the API rejects as malformed is malformed on every attempt.
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiError('Anthropic rejected the API key', {
      retryable: false,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new AiError('The Anthropic key lacks access to this model', {
      retryable: false,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiError('Unknown Anthropic model or endpoint', {
      retryable: false,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AiError(`Anthropic rejected the request: ${error.message}`, {
      retryable: false,
      status: error.status,
      cause: error,
    });
  }

  // A timeout or a dropped socket. The SDK has already retried this twice; the
  // queue's backoff is the longer-horizon version of the same idea.
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError('Could not reach the Anthropic API', {
      retryable: true,
      cause: error,
    });
  }

  // Any other non-2xx. Unknown territory, so bias to the safe side: 5xx-shaped
  // statuses are worth another attempt, everything else is not.
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    return new AiError(`Anthropic API error (${String(status ?? 'unknown')})`, {
      retryable: status !== undefined && status >= 500,
      status,
      cause: error,
    });
  }

  // Not an SDK error at all — a bug in our own prompt assembly or response
  // handling. Retrying our own bug five times helps nobody.
  return new AiError(error instanceof Error ? error.message : 'Unknown AI failure', {
    retryable: false,
    cause: error,
  });
}
