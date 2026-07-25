/**
 * The storage seam. Attachments (6.7) call these three methods and nothing
 * else, so the AWS SDK never appears at a call site and the driver swaps at
 * deploy time — filesystem or MinIO locally, S3 in AWS (8.6).
 */
export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksum: string;
}

export interface StorageDriver {
  readonly name: 'filesystem' | 's3';

  put(input: PutObjectInput): Promise<StoredObject>;

  get(key: string): Promise<Buffer>;

  /**
   * A URL the browser can follow to download the object.
   *
   * The S3 driver returns a genuinely presigned URL. The filesystem driver
   * returns an app-relative URL served by the API behind the normal session
   * check — the expiry is advisory there, since access control is the session,
   * not the URL. Callers must treat the result as opaque either way.
   */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;

  exists(key: string): Promise<boolean>;

  delete(key: string): Promise<void>;
}

export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`Unsafe storage key: ${key}`);
    this.name = 'StorageKeyError';
  }
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * Keys are built from Gmail message and attachment IDs, which are attacker-
 * influenced input. Anything that could escape the storage root is rejected
 * before it reaches a filesystem path or an S3 request.
 */
export function assertSafeKey(key: string): void {
  if (
    key.length === 0 ||
    key.length > 512 ||
    !SAFE_KEY.test(key) ||
    key.includes('..') ||
    key.includes('//')
  ) {
    throw new StorageKeyError(key);
  }
}
