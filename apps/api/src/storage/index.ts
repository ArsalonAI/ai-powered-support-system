import { env } from '../config/env.js';
import { FilesystemStorageDriver } from './filesystem-driver.js';
import type { StorageDriver } from './types.js';

export * from './types.js';
export { FilesystemStorageDriver } from './filesystem-driver.js';

export function createStorageDriver(): StorageDriver {
  switch (env.STORAGE_DRIVER) {
    case 'filesystem':
      return new FilesystemStorageDriver(env.STORAGE_LOCAL_ROOT);
    case 's3':
      // Added at 8.6. Failing loudly here beats silently writing customer
      // attachments to a container's ephemeral filesystem in production.
      throw new Error('S3 storage driver is not implemented yet (see task 8.6)');
  }
}

let cached: StorageDriver | undefined;

export function storage(): StorageDriver {
  cached ??= createStorageDriver();
  return cached;
}
