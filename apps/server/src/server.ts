import { createApp } from './app.js';
import { closeSessionPool } from './auth/session.js';
import { env } from './config/env.js';
import { disconnectPrisma } from './db/prisma.js';
import { assertDevDashboardAllowed } from './http/routes/dev.js';
import { logger } from './observability/logger.js';
import { storage } from './storage/index.js';

// The developer dashboard serves seeded credentials. Like the storage driver
// below, it is checked at boot so a production build fails to start rather than
// exposing them the first time someone opens the page.
assertDevDashboardAllowed();

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
    // The session store keeps its own pg pool alongside Prisma's — see
    // `auth/session.ts`. Both have to go, or the process never exits.
    void Promise.allSettled([disconnectPrisma(), closeSessionPool()]).finally(() =>
      process.exit(0),
    );
  });
  // A hung in-flight request must not hold the process open indefinitely.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
