import { CSRF_HEADER } from '@support/shared';
import { pino } from 'pino';
import { env, isProduction } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Structured JSON when NODE_ENV=production; readable line output locally.
  transport: isProduction ? undefined : { target: 'pino/file', options: { destination: 1 } },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      // The CSRF token is a session credential, for the same reason the cookie
      // is: the browser attaches the cookie by itself, so this header is the
      // only part of a state-changing request an attacker cannot reproduce.
      // Keyed off the shared constant so renaming the header cannot silently
      // un-redact it.
      `req.headers["${CSRF_HEADER}"]`,
      'password',
      'passwordHash',
      'token',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
