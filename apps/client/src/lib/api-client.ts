import { apiErrorSchema, CSRF_HEADER, type ApiErrorCode, type FieldIssue } from '@support/shared';
import { getCsrfToken } from './csrf';

/**
 * Thrown for every non-2xx API response. Carries the server's error code so
 * callers can branch on it — the global 401 handler in Phase 3 keys off
 * `UNAUTHENTICATED`.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'UNKNOWN';
  readonly issues: FieldIssue[] | undefined;
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: ApiErrorCode | 'UNKNOWN',
    message: string,
    options: { issues?: FieldIssue[]; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.issues = options.issues;
    this.requestId = options.requestId;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Relative by design — the SPA and `/api/*` share one origin, so cookies stay
 * `SameSite=Lax` and there is no CORS preflight. Never make this absolute.
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  // The session cookie is `SameSite=Lax` and same-origin, so the browser
  // attaches it on its own; the token is the part the server checks that a
  // cross-site request could not have supplied.
  const csrfToken = method === 'GET' ? null : getCsrfToken();

  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(csrfToken === null ? {} : { [CSRF_HEADER]: csrfToken }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiClientError(response.status, parsed.data.error.code, parsed.data.error.message, {
        ...(parsed.data.error.issues ? { issues: parsed.data.error.issues } : {}),
        ...(parsed.data.error.requestId ? { requestId: parsed.data.error.requestId } : {}),
      });
    }
    throw new ApiClientError(response.status, 'UNKNOWN', `Request failed (${response.status})`);
  }

  return payload as T;
}
