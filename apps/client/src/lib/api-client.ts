import { apiErrorSchema, type ApiErrorCode, type FieldIssue } from '@support/shared';
import { ACTING_USER_HEADER, getActingUserId } from './acting-user';

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

  // Task 2.1's seam: until sessions exist there is no cookie identifying the
  // agent, so writes carry the one chosen in the header switcher. Deleted at
  // 3.13 along with `lib/acting-user.ts`.
  const actingUserId = getActingUserId();

  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(actingUserId === null ? {} : { [ACTING_USER_HEADER]: actingUserId }),
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
