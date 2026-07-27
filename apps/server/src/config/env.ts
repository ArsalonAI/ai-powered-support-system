import { z } from 'zod';

/**
 * The environment is parsed exactly once, at boot, and the process exits if it
 * does not validate. A missing Gmail or Anthropic credential must crash on
 * startup, not on the first ticket.
 */
/**
 * A placeholder long enough to satisfy a length check is worse than a missing
 * value: it boots, and the "you must set this" instruction beside it reads as
 * satisfied. Anything that has ever appeared in `.env.example` or the README as
 * a fill-me-in belongs here, because copying it is the likeliest way it ends up
 * in a real `.env`.
 */
const PLACEHOLDER_SECRETS = new Set([
  'replace-me-with-openssl-rand-base64-48',
  'change-me-immediately',
]);

/**
 * `KEY=` in a `.env` file is an empty string, not an absent key. For a value
 * that is genuinely optional that has to mean "unset", or shipping the example
 * with the field blank — which is how a placeholder is avoided — would fail
 * every boot on a constraint meant for values that are actually present.
 */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

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

  /**
   * Signs the session cookie. No default: a fallback secret is a fallback
   * everywhere it is not overridden, and every session ever issued under it is
   * forgeable by anyone who has read this repository.
   *
   * Generate one with `openssl rand -base64 48`. Rotating it invalidates every
   * live session, which is the intended behaviour after a suspected leak.
   */
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters')
    .refine((value) => !PLACEHOLDER_SECRETS.has(value), {
      message:
        'SESSION_SECRET is still a placeholder from .env.example. Generate one: openssl rand -base64 48',
    }),

  /**
   * Idle timeout, renewed on every request (`rolling`). A cookie untouched for
   * this long is dead.
   *
   * The tech stack lists concrete timeout values as an open item; these are
   * defaults for a small in-house team on one machine, not a decision.
   */
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(120),

  /**
   * The hard ceiling, stamped at login. Activity renews the idle window but
   * never this — a stolen cookie has a bounded life no matter how busy it is.
   */
  SESSION_ABSOLUTE_LIFETIME_HOURS: z.coerce.number().int().positive().default(12),

  /**
   * Whether new passwords are checked against HIBP's range API. On by default;
   * `off` for an air-gapped machine or a test run that must not touch the
   * network. It fails open either way — see `auth/password-policy.ts`.
   */
  PASSWORD_BREACH_CHECK: z.enum(['on', 'off']).default('on'),

  /** Attachments land on the local disk under this root. */
  STORAGE_DRIVER: z.literal('filesystem').default('filesystem'),
  STORAGE_LOCAL_ROOT: z.string().default('.storage'),

  /**
   * Seeded by the bootstrap-admin task only; not required to boot the API.
   *
   * The password is rejected if it is a known placeholder for the same reason
   * `SESSION_SECRET` is — and it matters more here, because this one is a live
   * ADMIN login the moment the seed runs. `mustChangePassword` is set on that
   * account but nothing enforces it until task 4.7.
   */
  BOOTSTRAP_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
  BOOTSTRAP_ADMIN_PASSWORD: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .min(12)
      .refine((value) => !PLACEHOLDER_SECRETS.has(value), {
        message:
          'BOOTSTRAP_ADMIN_PASSWORD is still the .env.example placeholder. Choose a real one.',
      })
      .optional(),
  ),
  BOOTSTRAP_ADMIN_NAME: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
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
