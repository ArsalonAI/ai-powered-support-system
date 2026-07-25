import { describe, expect, it } from 'vitest';
import { fakeVerify, hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('produces an argon2id hash that verifies against the original password', async () => {
    const stored = await hashPassword('correct horse battery staple');

    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');

    expect(await verifyPassword(stored, 'Correct horse battery staple')).toBe(false);
  });

  it('salts: the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same-password'),
      hashPassword('same-password'),
    ]);

    expect(a).not.toBe(b);
  });

  it('treats a malformed stored hash as a failed verification, not an error', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });

  it('fakeVerify always returns false', async () => {
    expect(await fakeVerify()).toBe(false);
  });
});
