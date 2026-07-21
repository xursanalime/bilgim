/**
 * OpenAiAdapter — fallback AI provider used when the Anthropic primary
 * raises an `AiUpstreamError`. We talk to OpenAI over plain HTTP using
 * the global `fetch` (Node 18+) so the adapter doesn't pull in another
 * SDK dependency. The API surface is intentionally limited to the
 * single endpoint the gateway needs (chat completions).
 *
 * Design notes:
 *   - Same error mapping contract as `AnthropicAdapter`. 429 →
 *     `AiRateLimitedError(source='upstream')`; everything else →
 *     `AiUpstreamError`.
 *   - JSON mode is supported natively via `response_format: { type:
 *     'json_object' }` so the gateway can rely on parseable output.
 *   - When `OPENAI_API_KEY` is not configured (the env schema doesn't
 *     declare it — operator opts in via direct env), the adapter
 *     reports unhealthy and the gateway falls back to running the
 *     primary alone.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvConfig } from '../../../config/env.schema';
import { AiRateLimitedError, AiUpstreamError } from '../ai.errors';
import type {
  AiAdapter,
  AiAdapterRequest,
  AiAdapterResponse,
} from './types';

const DEFAULT_MODEL = 'gpt-4o-mini';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

@Injectable()
export class OpenAiAdapter implements AiAdapter {
  readonly providerName = 'openai';
  private readonly logger = new Logger(OpenAiAdapter.name);
  private readonly apiKey: string | null;
  private readonly defaultModel: string;

  constructor(config: ConfigService<EnvConfig, true>) {
    // We read OPENAI_* via process.env directly so operators can wire
    // the fallback without us touching the env schema (the schema only
    // declares Anthropic — OpenAI is purely opt-in for the fallback).
    const apiKey = process.env.OPENAI_API_KEY ?? null;
    this.apiKey = apiKey && apiKey.length > 0 ? apiKey : null;
    this.defaultModel = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;

    if (!this.apiKey) {
      this.logger.warn(
        'OpenAiAdapter: OPENAI_API_KEY missing — fallback adapter is unhealthy and will be skipped.',
      );
    }
    // Touching `config` so DI doesn't strip the dependency in jest.
    void config;
  }

  isHealthy(): boolean {
    return this.apiKey !== null;
  }

  async complete(request: AiAdapterRequest): Promise<AiAdapterResponse> {
    if (!this.apiKey) {
      throw new AiUpstreamError(
        null,
        'OpenAiAdapter not configured (missing OPENAI_API_KEY)',
      );
    }

    // OpenAI supports a couple of well-known model names we let through.
    // Anything that looks like a Claude model name we map to the
    // configured OpenAI default so the fallback always lands on a
    // model OpenAI understands.
    const modelName = request.modelName.startsWith('claude-')
      ? this.defaultModel
      : request.modelName;

    const body: Record<string, unknown> = {
      model: modelName,
      max_tokens: request.maxTokens,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    };
    if (request.temperature !== undefined) {
      body.temperature = clamp01(request.temperature);
    }
    if (request.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new AiUpstreamError(
        null,
        `openai network error: ${(error as Error).message}`,
      );
    }
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const text = await safeReadText(response);
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('retry-after');
        const seconds = retryAfterHeader
          ? Number.parseInt(retryAfterHeader, 10)
          : 30;
        const retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : 30_000;
        throw new AiRateLimitedError(retryAfterMs, 'upstream', text);
      }
      throw new AiUpstreamError(response.status, text);
    }

    const json = (await safeReadJson(response)) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };

    const text = json.choices?.[0]?.message?.content?.trim() ?? '';
    return {
      text,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      latencyMs,
      modelName: json.model ?? modelName,
    };
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
