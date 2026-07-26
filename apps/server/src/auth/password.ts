import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id. Parameters follow OWASP's second recommended configuration
 * (19 MiB, t=2, p=1) — enough work to matter without making a login feel slow.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  // 2 === argon2id in @node-rs/argon2's Algorithm enum.
  algorithm: 2,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plaintext, ARGON2_OPTIONS);
  } catch {
    // A malformed stored hash must read as "wrong password", not as a 500 that
    // tells an attacker something about the account.
    return false;
  }
}

/**
 * Burns roughly the same CPU as a real verification. Login runs this when the
 * email is unknown, so response timing does not leak account existence.
 */
const DUMMY_HASH_PROMISE = hashPassword('unused-timing-equalizer-password');

export async function fakeVerify(): Promise<false> {
  await verify(await DUMMY_HASH_PROMISE, 'wrong-password', ARGON2_OPTIONS).catch(() => false);
  return false;
}
