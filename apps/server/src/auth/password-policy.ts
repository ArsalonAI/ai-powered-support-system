import { createHash } from 'node:crypto';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnEn from '@zxcvbn-ts/language-en';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@support/shared';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

/**
 * Task 3.2. Three independent checks, in increasing order of cost:
 *
 * 1. length — 12 characters, the only hard rule (no composition requirements)
 * 2. strength — `zxcvbn`, offline, catches `correcthorse` and `Support2026!`
 * 3. breach — HIBP's range API, catches passwords that are strong-looking but
 *    already in a dump
 *
 * They are separate because they fail differently. 1 and 2 are deterministic and
 * offline; 3 depends on a network the machine may not have. Bundling the breach
 * check into the strength score (`@zxcvbn-ts/matcher-pwned` does exactly that)
 * would hide that difference behind one number.
 */

const zxcvbn = new ZxcvbnFactory({
  translations: zxcvbnEn.translations,
  graphs: zxcvbnCommon.adjacencyGraphs,
  dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnEn.dictionary },
});

/**
 * zxcvbn scores 0–4. 3 is "safely unguessable" — offline attack needs 10^8+
 * guesses. Below that is where reused human-memorable passwords land.
 */
const MIN_ZXCVBN_SCORE = 3;

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const HIBP_TIMEOUT_MS = 3_000;

export interface PolicyResult {
  ok: boolean;
  /** User-facing, and safe to show: none of these leak anything about accounts. */
  problems: string[];
}

/** Injected in tests so the breach check can be exercised without a network. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/**
 * Strings that zxcvbn should treat as dictionary words for this particular
 * user — an agent whose password is their own email is not protected by a
 * generic dictionary.
 */
export interface PasswordContext {
  email?: string;
  name?: string;
}

function contextInputs(context: PasswordContext): string[] {
  const inputs: string[] = [];
  if (context.email) {
    inputs.push(context.email, context.email.split('@')[0] ?? '');
  }
  if (context.name) {
    inputs.push(context.name, ...context.name.split(/\s+/));
  }
  return inputs.filter((value) => value.length > 0);
}

/** Length and strength. Synchronous, offline, and always runs. */
export function checkPasswordStrength(
  password: string,
  context: PasswordContext = {},
): PolicyResult {
  const problems: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }

  // Only worth scoring if it cleared the length floor; zxcvbn on a 4-character
  // password just restates what the length check already said.
  if (problems.length === 0) {
    const result = zxcvbn.check(password, contextInputs(context));
    if (result.score < MIN_ZXCVBN_SCORE) {
      const feedback = [result.feedback.warning, ...result.feedback.suggestions]
        .filter((line): line is string => Boolean(line))
        .join(' ');
      problems.push(
        feedback
          ? `Password is too easy to guess. ${feedback}`
          : 'Password is too easy to guess. Try a longer phrase of unrelated words.',
      );
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * HIBP's range API, k-anonymity: only the first five characters of the SHA-1
 * leave the machine, and the response is the ~500 suffixes sharing that prefix.
 * The password itself is never sent.
 */
export async function isPasswordBreached(
  password: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const response = await fetchImpl(`${HIBP_RANGE_URL}${prefix}`, {
    signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HIBP range API returned ${response.status}`);
  }

  const body = await response.text();
  for (const line of body.split('\n')) {
    // Lines are `SUFFIX:COUNT`. Any count at all means the hash is in a dump.
    if (line.slice(0, suffix.length).toUpperCase() === suffix) {
      return true;
    }
  }
  return false;
}

/**
 * The full policy. Strength first — if the password is weak there is no point
 * asking a third party about it, and no reason to send its hash prefix.
 *
 * **The breach check fails open, deliberately.** This runs on a laptop that is
 * routinely offline, and the alternative is that a network hiccup blocks a
 * password reset during an incident. It is logged at `warn` so a permanently
 * broken check is visible rather than silently absent. Set
 * `PASSWORD_BREACH_CHECK=off` to skip it entirely.
 */
export async function checkPasswordPolicy(
  password: string,
  context: PasswordContext = {},
  options: { fetchImpl?: FetchLike; breachCheck?: boolean } = {},
): Promise<PolicyResult> {
  const { fetchImpl = fetch, breachCheck = env.PASSWORD_BREACH_CHECK === 'on' } = options;

  const strength = checkPasswordStrength(password, context);
  if (!strength.ok || !breachCheck) {
    return strength;
  }

  try {
    if (await isPasswordBreached(password, fetchImpl)) {
      return {
        ok: false,
        problems: [
          'This password has appeared in a known data breach. Choose one you have not used elsewhere.',
        ],
      };
    }
  } catch (error) {
    logger.warn(
      { err: error },
      'HIBP breach check unavailable; accepting password on strength alone',
    );
  }

  return { ok: true, problems: [] };
}
