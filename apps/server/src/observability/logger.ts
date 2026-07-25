import { pino } from 'pino';
import { env, isProduction } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Structured JSON in production (CloudWatch parses it); readable locally.
  transport: isProduction ? undefined : { target: 'pino/file', options: { destination: 1 } },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
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
