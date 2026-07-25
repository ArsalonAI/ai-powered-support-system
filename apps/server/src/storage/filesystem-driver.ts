import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  assertSafeKey,
  ObjectNotFoundError,
  type PutObjectInput,
  type StorageDriver,
  type StoredObject,
} from './types.js';

/**
 * Local stand-in for S3. Same interface, same call sites — the only difference
 * is where the bytes land and what `signedUrl` can promise.
 */
export class FilesystemStorageDriver implements StorageDriver {
  readonly name = 'filesystem' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const path = resolve(join(this.root, key));
    // Belt and braces: `assertSafeKey` already rejects traversal, but a path
    // that resolves outside the root must never be written to regardless.
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new ObjectNotFoundError(key);
    }
    return path;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const path = this.pathFor(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);

    return {
      key: input.key,
      sizeBytes: input.body.byteLength,
      checksum: createHash('sha256').update(input.body).digest('hex'),
    };
  }

  async get(key: string): Promise<Buffer> {
    const path = this.pathFor(key);
    try {
      return await readFile(path);
    } catch {
      throw new ObjectNotFoundError(key);
    }
  }

  async signedUrl(key: string): Promise<string> {
    assertSafeKey(key);
    // Served by the API behind the session check; see StorageDriver.signedUrl.
    return `/api/attachments/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await readFile(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
