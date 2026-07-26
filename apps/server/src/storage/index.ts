import { env } from '../config/env.js';
import { FilesystemStorageDriver } from './filesystem-driver.js';
import type { StorageDriver } from './types.js';

export * from './types.js';
export { FilesystemStorageDriver } from './filesystem-driver.js';

export function createStorageDriver(): StorageDriver {
  return new FilesystemStorageDriver(env.STORAGE_LOCAL_ROOT);
}

let cached: StorageDriver | undefined;

export function storage(): StorageDriver {
  cached ??= createStorageDriver();
  return cached;
}
