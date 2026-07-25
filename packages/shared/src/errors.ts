import { z } from 'zod';

/**
 * The single API error shape. Every non-2xx response from the API has this
 * body — the error middleware guarantees it, and the web client parses it.
 * Stack traces never cross this boundary.
 */
export const apiErrorCodes = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'ILLEGAL_TRANSITION',
  'RATE_LIMITED',
  'INTERNAL',
  'SERVICE_UNAVAILABLE',
] as const;

export type ApiErrorCode = (typeof apiErrorCodes)[number];

export const fieldIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(apiErrorCodes),
    message: z.string(),
    /** Present only for VALIDATION_FAILED. */
    issues: z.array(fieldIssueSchema).optional(),
    /** Correlates a user-visible error with a log line and an OTel trace. */
    requestId: z.string().optional(),
  }),
});

export type FieldIssue = z.infer<typeof fieldIssueSchema>;
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
