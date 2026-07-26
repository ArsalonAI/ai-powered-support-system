import { z } from 'zod';

/**
 * The environment is parsed exactly once, at boot, and the process exits if it
 * does not validate. A missing Gmail or Anthropic credential must crash on
 * startup, not on the first ticket.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Reported by `/api/health`, so a deploy can be verified as having landed. */
  APP_VERSION: z.string().default('0.1.0'),

  /**
   * Serves Swagger UI at `/api/docs` and the raw spec at `/api/openapi.json`.
   *
   * Defaults on outside production and off in production: an interactive
   * console over customer data is precisely what the PRD's no-public-routes
   * rule exists to prevent, so enabling it in production has to be deliberate.
   */
  ENABLE_API_DOCS: z.enum(['true', 'false']).optional(),

  DATABASE_URL: z.string().url(),

  /**
   * How many proxy hops to trust for `req.ip`. Nothing sits in front of the
   * API, so this is 0 — and it should stay 0 unless a reverse proxy is
   * genuinely added. Too high and a client can spoof its own address through
   * `X-Forwarded-For`, which is what the Phase 3 per-IP rate limiter buckets
   * on.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  /** Attachments land on the local disk under this root. */
  STORAGE_DRIVER: z.literal('filesystem').default('filesystem'),
  STORAGE_LOCAL_ROOT: z.string().default('.storage'),

  /** Seeded by the bootstrap-admin task only; not required to boot the API. */
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export type EnvSource = Record<string, string | undefined>;

/**
 * Pure parse — exported so tests can assert the failure modes without touching
 * `process.env` or the exit path.
 */
export function parseEnv(source: EnvSource) {
  return envSchema.safeParse(source);
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

export function loadEnv(source: EnvSource = process.env): Env {
  const result = parseEnv(source);
  if (!result.success) {
    // Deliberately not the logger: this runs before the logger is configured.
    console.error(`Invalid environment configuration:\n${formatIssues(result.error)}`);
    process.exit(1);
  }
  return result.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Unset means "on everywhere except production". Setting it explicitly wins in
 * both directions, so exposing the docs in production is possible but never
 * accidental.
 */
export const apiDocsEnabled =
  env.ENABLE_API_DOCS === undefined ? !isProduction : env.ENABLE_API_DOCS === 'true';
