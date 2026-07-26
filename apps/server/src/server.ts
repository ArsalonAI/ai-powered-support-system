import { createApp } from './app.js';
import { assertActingUserSeamAllowed } from './auth/acting-user.js';
import { env } from './config/env.js';
import { disconnectPrisma } from './db/prisma.js';
import { logger } from './observability/logger.js';
import { storage } from './storage/index.js';

// Task 2.1's seam attributes writes to a seeded agent because there is no login
// until Phase 3. It is a development stand-in and must never boot in production,
// so this fails startup rather than waiting for the first reply to be sent.
assertActingUserSeamAllowed();

// Construct the storage driver at boot rather than on first use. A driver that
// cannot be configured must crash at startup, not on the first inbound email
// that happens to carry an attachment — that failure would stall ingestion with
// no signal until the dead-man's switch fires hours later.
const storageDriver = storage();

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV, storage: storageDriver.name }, 'api listening');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void disconnectPrisma().finally(() => process.exit(0));
  });
  // A hung in-flight request must not hold the process open indefinitely.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
