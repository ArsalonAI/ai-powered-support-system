import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  checkPasswordPolicy,
  checkPasswordStrength,
  isPasswordBreached,
  type FetchLike,
} from './password-policy.js';

/**
 * Every test here injects its own fetch. The real HIBP API is never called: it
 * would make the suite slow, flaky, and dependent on a third party's uptime.
 */

function sha1Upper(value: string): string {
  return createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase();
}

/** A range response shaped like HIBP's: `SUFFIX:COUNT` lines, CRLF-separated. */
function rangeResponse(suffixes: string[]): Response {
  return new Response(suffixes.map((suffix) => `${suffix}:42`).join('\r\n'), { status: 200 });
}

describe('password strength', () => {
  it('rejects a password shorter than 12 characters', () => {
    const result = checkPasswordStrength('Sh0rt!x');

    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('at least 12 characters');
  });

  it('rejects a long but guessable password', () => {
    const result = checkPasswordStrength('passwordpassword');

    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('too easy to guess');
  });

  it('accepts a long passphrase of unrelated words', () => {
    expect(checkPasswordStrength('velvet-anchor-tuesday-marmalade').ok).toBe(true);
  });

  it('imposes no composition rules — an all-lowercase passphrase passes', () => {
    expect(checkPasswordStrength('trombone spatula glacier kettle').ok).toBe(true);
  });

  it("rejects the user's own email and name as a password", () => {
    const context = { email: 'maria.santos@example.com', name: 'Maria Santos' };

    expect(checkPasswordStrength('maria.santos@example.com', context).ok).toBe(false);
    expect(checkPasswordStrength('Maria Santos', context).ok).toBe(false);
  });

  it('rejects an identity-derived password that would pass for anyone else', () => {
    // Same string, two verdicts. Without the context inputs this is an obscure
    // pair of words and zxcvbn has no reason to object — the rejection comes
    // entirely from knowing whose password it is.
    expect(checkPasswordStrength('zenobiakowalczyk').ok).toBe(true);
    expect(
      checkPasswordStrength('zenobiakowalczyk', {
        email: 'zenobia.kowalczyk@example.com',
        name: 'Zenobia Kowalczyk',
      }).ok,
    ).toBe(false);
  });

  it('reports only the length problem when the password is also weak', () => {
    // Otherwise the user fixes the strength complaint and is told about length
    // on the next attempt — two round trips for one password.
    expect(checkPasswordStrength('abc').problems).toHaveLength(1);
  });
});

describe('breach check (HIBP k-anonymity)', () => {
  it('sends only the first five hash characters, never the password', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(rangeResponse(['0000000000000000000000000000000000000']));

    await isPasswordBreached('velvet-anchor-tuesday-marmalade', fetchImpl);

    const url = fetchImpl.mock.calls[0]![0];
    expect(url).toBe(
      `https://api.pwnedpasswords.com/range/${sha1Upper('velvet-anchor-tuesday-marmalade').slice(0, 5)}`,
    );
    expect(url).not.toContain('velvet');
    // The full hash must not leave either — only the 5-character prefix.
    expect(url).not.toContain(sha1Upper('velvet-anchor-tuesday-marmalade').slice(5, 12));
  });

  it('reports a hit when the suffix is in the range', async () => {
    const suffix = sha1Upper('breached-password-example').slice(5);
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(rangeResponse(['AAAAAAAAAA', suffix]));

    expect(await isPasswordBreached('breached-password-example', fetchImpl)).toBe(true);
  });

  it('reports a miss when the suffix is absent from the range', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(rangeResponse(['AAAAAAAAAA', 'BBBBBBBBBB']));

    expect(await isPasswordBreached('velvet-anchor-tuesday-marmalade', fetchImpl)).toBe(false);
  });
});

describe('full policy', () => {
  const strong = 'velvet-anchor-tuesday-marmalade';

  it('rejects a breached password even when it scores as strong', async () => {
    const suffix = sha1Upper(strong).slice(5);
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(rangeResponse([suffix]));

    const result = await checkPasswordPolicy(strong, {}, { fetchImpl, breachCheck: true });

    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('known data breach');
  });

  it('fails open when HIBP is unreachable', async () => {
    // A laptop offline mid-incident must not be unable to set a password. The
    // strength check still ran, so this is a downgrade, not an open door.
    const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(new Error('ENOTFOUND'));

    expect((await checkPasswordPolicy(strong, {}, { fetchImpl, breachCheck: true })).ok).toBe(true);
  });

  it('fails open when HIBP answers with an error status', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(new Response('', { status: 503 }));

    expect((await checkPasswordPolicy(strong, {}, { fetchImpl, breachCheck: true })).ok).toBe(true);
  });

  it('does not call HIBP for a password that already failed on strength', async () => {
    const fetchImpl = vi.fn<FetchLike>();

    const result = await checkPasswordPolicy('password1234', {}, { fetchImpl, breachCheck: true });

    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips the breach check entirely when it is switched off', async () => {
    const fetchImpl = vi.fn<FetchLike>();

    expect((await checkPasswordPolicy(strong, {}, { fetchImpl, breachCheck: false })).ok).toBe(
      true,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
