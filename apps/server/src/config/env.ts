import { z } from 'zod';

/**
 * The environment is parsed exactly once, at boot, and the process exits if it
 * does not validate. A missing Gmail or Anthropic credential must crash on
 * deploy, not on the first ticket.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Reported by `/api/health`, so a deploy can be verified as having landed. */
  APP_VERSION: z.string().default('0.1.0'),

  DATABASE_URL: z.string().url(),

  /**
   * How many proxy hops to trust for `req.ip`. Get this wrong and the Phase 2
   * per-IP rate limiter buckets everyone behind the last proxy together:
   * too low and one CloudFront edge shares a bucket (locking out a whole
   * region while an attacker rotating edges is barely limited), too high and a
   * client can spoof its own address through `X-Forwarded-For`.
   *
   * Deployed topology is CloudFront → ALB → api, so production sets 2.
   * Locally there is no proxy in front of the API, so the default is 0.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  /** Attachment storage. `s3` is wired at 8.6; the local driver is the default. */
  STORAGE_DRIVER: z.enum(['filesystem', 's3']).default('filesystem'),
  STORAGE_LOCAL_ROOT: z.string().default('.storage'),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().optional(),

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
  if (result.data.STORAGE_DRIVER === 's3' && !result.data.STORAGE_S3_BUCKET) {
    console.error(
      'Invalid environment configuration:\n  STORAGE_S3_BUCKET: required when STORAGE_DRIVER=s3',
    );
    process.exit(1);
  }
  return result.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
