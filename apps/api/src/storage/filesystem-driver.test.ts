import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemStorageDriver } from './filesystem-driver.js';
import { ObjectNotFoundError, StorageKeyError } from './types.js';

let root: string;
let driver: FilesystemStorageDriver;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'support-storage-'));
  driver = new FilesystemStorageDriver(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('FilesystemStorageDriver', () => {
  it('round-trips an object and reports its size and checksum', async () => {
    const body = Buffer.from('invoice contents');

    const stored = await driver.put({
      key: 'attachments/2026/invoice.pdf',
      body,
      contentType: 'application/pdf',
    });

    expect(stored.sizeBytes).toBe(body.byteLength);
    expect(stored.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(await driver.get('attachments/2026/invoice.pdf')).toEqual(body);
  });

  it('reports existence and deletes', async () => {
    await driver.put({ key: 'a/b.txt', body: Buffer.from('x'), contentType: 'text/plain' });
    expect(await driver.exists('a/b.txt')).toBe(true);

    await driver.delete('a/b.txt');
    expect(await driver.exists('a/b.txt')).toBe(false);
  });

  it('throws ObjectNotFoundError for a missing key', async () => {
    await expect(driver.get('nope/missing.txt')).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  // Keys are derived from Gmail-supplied IDs, so traversal is attacker-reachable.
  it.each([
    '../escape.txt',
    'attachments/../../escape.txt',
    '/absolute/path.txt',
    'has space.txt',
    'double//slash.txt',
    '',
  ])('rejects the unsafe key %j', async (key) => {
    await expect(
      driver.put({ key, body: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toBeInstanceOf(StorageKeyError);
  });

  it('returns an app-relative URL the API serves behind the session check', async () => {
    expect(await driver.signedUrl('attachments/x.pdf')).toBe('/api/attachments/attachments/x.pdf');
  });
});
