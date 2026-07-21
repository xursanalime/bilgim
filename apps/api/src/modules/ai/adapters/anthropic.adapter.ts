/**
 * AnthropicAdapter — primary AI provider for the gateway.
 *
 * Responsibilities:
 *   - Translate the gateway's flat `AiAdapterRequest` into the
 *     Anthropic `messages.create` payload.
 *   - Map provider errors onto `AiRateLimitedError` / `AiUpstreamError`
 *     so the gateway can decide whether to fall back.
 *   - Track wall-clock latency and surface upstream token usage so the
 *     cost calculator can write accurate `AiCall` rows.
 *
 * What this adapter MUST NOT do:
 *   - Touch the DB.
 *   - Enforce rate limits or policy checks (that's the gateway).
 *   - Read env vars directly past construction. The module wires the
 *     API key in once and the adapter holds onto the SDK client.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

import type { EnvConfig } from '../../../config/env.schema';
import { AiRateLimitedError, AiUpstreamError } from '../ai.errors';
import type {
  AiAdapter,
  AiAdapterRequest,
  AiAdapterResponse,
} from './types';

@Injectable()
export class AnthropicAdapter implements AiAdapter {
  readonly providerName = 'anthropic';
  private readonly logger = new Logger(AnthropicAdapter.name);
  private readonly client: Anthropic | null;

  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    const apiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
    if (!apiKey) {
      this.logger.warn(
        'AnthropicAdapter: ANTHROPIC_API_KEY missing — adapter is unhealthy and will be skipped.',
      );
      this.client = null;
      return;
    }
    this.client = new Anthropic({ apiKey });
  }

  isHealthy(): boolean {
    return this.client !== null;
  }

  async complete(request: AiAdapterRequest): Promise<AiAdapterResponse> {
    if (!this.client) {
      throw new AiUpstreamError(
        null,
        'AnthropicAdapter not configured (missing ANTHROPIC_API_KEY)',
      );
    }

    // Anthropic does not have a first-class JSON mode — the strongest
    // contract is a system-prompt suffix. Reading runtime tests assert
    // we still return well-formed JSON, so the gateway parses
    // defensively after the call.
    const systemPrompt = request.jsonMode
      ? `${request.system}\n\nRespond with valid JSON only — no prose, no code fences.`
      : request.system;

    const startedAt = Date.now();
    try {
      const response = await this.client.messages.create({
        model: request.modelName,
        max_tokens: request.maxTokens,
        system: systemPrompt,
        ...(request.temperature !== undefined && {
          temperature: clamp01(request.temperature),
        }),
        messages: [
          {
            role: 'user',
            content: request.user,
          },
        ],
      });

      const latencyMs = Date.now() - startedAt;
      const text = extractText(response);

      return {
        text,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        latencyMs,
        modelName: response.model ?? request.modelName,
      };
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }
}

// ===================================================================
// Internal helpers
// ===================================================================

function extractText(response: Anthropic.Messages.Message): string {
  const blocks = response.content ?? [];
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('').trim();
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Map Anthropic SDK errors to the gateway's typed exceptions.
 * - 429 → `AiRateLimitedError(source='upstream')` so the gateway can
 *   decide whether to fall back vs surface the limit verbatim.
 * - Other 4xx / 5xx → `AiUpstreamError`, which the gateway treats as a
 *   fallback candidate.
 */
function mapAnthropicError(error: unknown): Error {
  // Anthropic SDK throws `APIError` subclasses with a `.status` field.
  const anyErr = error as {
    status?: number;
    message?: string;
    headers?: Record<string, string>;
  };
  const status = typeof anyErr.status === 'number' ? anyErr.status : null;
  const message = anyErr.message ?? 'unknown anthropic error';

  if (status === 429) {
    const retryAfterHeader = anyErr.headers?.['retry-after'];
    const retryAfterSeconds = retryAfterHeader
      ? Number.parseInt(retryAfterHeader, 10)
      : 30;
    const retryAfterMs = Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1000
      : 30_000;
    return new AiRateLimitedError(retryAfterMs, 'upstream', message);
  }

  return new AiUpstreamError(status, message);
}
