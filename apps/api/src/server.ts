import { createApp } from './app.js';
import { env } from './config/env.js';
import { disconnectPrisma } from './db/prisma.js';
import { logger } from './observability/logger.js';
import { storage } from './storage/index.js';

// Construct the storage driver at boot rather than on first use. A driver that
// is configured but unimplemented must crash the deploy, not the first inbound
// email that happens to carry an attachment — that failure would stall
// ingestion with no signal until the dead-man's switch fires hours later.
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
  // ECS sends SIGTERM and kills after 30s; don't hang past that.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
