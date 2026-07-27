import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';
import { AiError, toAiError } from './errors.js';

/**
 * The Anthropic client wrapper (task 5.2).
 *
 * Everything that talks to Claude goes through `AiClient`. That is what lets the
 * summarize job be tested without a network call or an API key — the tests pass
 * in a fake, not a mocked module — and it is where the parameter decisions from
 * docs/tech-stack.md are made once instead of at every call site.
 */

/**
 * The stack tunes effort per call rather than swapping model tiers: `low` for
 * classification and summaries, `high` for drafts. Narrower than the API's five
 * levels because these are the only two the PRD asks for; widen it when a call
 * genuinely needs more.
 */
export type AiEffort = 'low' | 'high';

export interface StructuredRequest {
  /** Names the call in logs. Not sent to the model. */
  operation: string;
  /**
   * Stable content first. There is no knowledge base in the prompt yet — that
   * is task 5.3 — so nothing here is cacheable, but the ordering is the one the
   * cache breakpoint will need, so it does not get reshuffled later.
   */
  system: string;
  /** The volatile part: this ticket's thread. */
  userText: string;
  /** JSON Schema the response is constrained to. Needs `additionalProperties: false`. */
  schema: Record<string, unknown>;
  effort: AiEffort;
  maxTokens: number;
}

export interface AiClient {
  /** Resolves to the parsed JSON body. The caller validates its shape. */
  completeStructured(request: StructuredRequest): Promise<unknown>;
}

/**
 * Fails the boot of any process that needs Claude.
 *
 * Called from the worker's entry point, the same way `assertDevDashboardAllowed`
 * is called from the API's: a missing credential should stop the process that
 * depends on it rather than surfacing as a dead-lettered job hours later. The
 * API deliberately does not call this — it never talks to Anthropic, and the
 * test suite runs with no key at all.
 */
export function assertAiConfigured(): void {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. The worker drains AI jobs and cannot run without it — ' +
        'add it to apps/server/.env (see .env.example).',
    );
  }
}

let cached: AiClient | undefined;

/** Constructed once and lazily, so importing this module needs no credentials. */
export function aiClient(): AiClient {
  cached ??= new AnthropicAiClient();
  return cached;
}

export class AnthropicAiClient implements AiClient {
  private readonly anthropic: Anthropic;

  constructor() {
    assertAiConfigured();
    this.anthropic = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      timeout: env.ANTHROPIC_TIMEOUT_MS,
      // The SDK's own retries cover the brief transients. Anything that
      // survives them is the job queue's problem, on a much longer horizon.
      maxRetries: 2,
    });
  }

  async completeStructured(request: StructuredRequest): Promise<unknown> {
    const startedAt = Date.now();

    let response: Anthropic.Message;
    try {
      response = await this.anthropic.messages.create({
        model: env.ANTHROPIC_MODEL,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.userText }],
        output_config: {
          // Inside output_config, not top-level. Controls thinking depth and
          // overall spend; `thinking` itself is deliberately left unset, which
          // on this model means adaptive. Disabling it is both a worse
          // cost lever than low effort and a source of its own failure modes.
          effort: request.effort,
          // Structured output is what makes the response parseable without
          // hoping the model skipped its preamble. It is also the documented
          // replacement for assistant prefills, which this model rejects.
          format: { type: 'json_schema', schema: request.schema },
        },
      });
    } catch (error) {
      const aiError = toAiError(error);
      logger.warn(
        {
          operation: request.operation,
          model: env.ANTHROPIC_MODEL,
          effort: request.effort,
          latencyMs: Date.now() - startedAt,
          status: aiError.status,
          retryable: aiError.retryable,
          err: aiError,
        },
        'anthropic call failed',
      );
      throw aiError;
    }

    // Cost attribution. Real spans are task 5.16; this is the log line that
    // makes spend visible in the meantime, and it should not be mistaken for
    // the finished instrumentation.
    logger.info(
      {
        operation: request.operation,
        model: response.model,
        effort: request.effort,
        latencyMs: Date.now() - startedAt,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens,
        stopReason: response.stop_reason,
      },
      'anthropic call completed',
    );

    return parseStructuredResponse(request.operation, response);
  }
}

/**
 * Exported for the tests, which assert the refusal and truncation paths without
 * standing up a client.
 */
export function parseStructuredResponse(operation: string, response: Anthropic.Message): unknown {
  // Checked before reading `content`, which is empty on a pre-output refusal.
  // Indexing into it first is how this becomes a confusing crash instead of a
  // clear one.
  if (response.stop_reason === 'refusal') {
    throw new AiError(`Claude declined the ${operation} request`, { retryable: false });
  }

  // A truncated response is truncated JSON, so it will not parse. Retrying
  // reproduces it exactly — the fix is a larger max_tokens, which is a code
  // change, not a backoff.
  if (response.stop_reason === 'max_tokens') {
    throw new AiError(`The ${operation} response hit max_tokens and was cut off`, {
      retryable: false,
    });
  }

  // Thinking blocks are present but carry no text on this model, so the answer
  // is whatever text blocks came back.
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) {
    throw new AiError(`Claude returned no text for ${operation}`, { retryable: false });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    // Structured outputs make this close to impossible, which is exactly why it
    // is worth failing loudly rather than falling back to treating the raw text
    // as the answer.
    throw new AiError(`Could not parse the ${operation} response as JSON`, {
      retryable: false,
      cause: error,
    });
  }
}
