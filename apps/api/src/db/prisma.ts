import { PrismaClient } from '@prisma/client';
import { env, isProduction, isTest } from '../config/env.js';

/**
 * One client per process. Reused across hot reloads in dev so `tsx watch` does
 * not exhaust the connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: isProduction || isTest ? ['warn', 'error'] : ['query', 'warn', 'error'],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}

export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
