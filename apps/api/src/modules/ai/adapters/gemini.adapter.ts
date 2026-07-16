/**
 * GeminiAdapter — Google Gemini AI provider. Implemented in the same
 * style as `OpenAiAdapter`: we talk to the Generative Language API
 * over the global `fetch` (Node 18+) so the adapter doesn't pull in
 * another SDK dependency. The API surface is limited to the single
 * endpoint the gateway needs (`:generateContent`).
 *
 * Design notes:
 *   - Same error mapping contract as `AnthropicAdapter` /
 *     `OpenAiAdapter`. 429 → `AiRateLimitedError(source='upstream')`;
 *     everything else non-OK → `AiUpstreamError`; network throw →
 *     `AiUpstreamError(null, message)`.
 *   - Configuration comes from the env schema (`GEMINI_API_KEY`,
 *     `GEMINI_MODEL`) via `ConfigService`. When `GEMINI_API_KEY` is
 *     missing the adapter reports unhealthy so the module skips it.
 *   - Auth uses the standard API-key path (`?key=`). We additionally
 *     send the `x-goog-api-key` header so OAuth-style keys still work
 *     against endpoints that prefer the header.
 *   - JSON mode is requested via `generationConfig.responseMimeType:
 *     'application/json'` so the gateway can rely on parseable output.
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

const DEFAULT_MODEL = 'gemini-1.5-flash';
const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

@Injectable()
export class GeminiAdapter implements AiAdapter {
  readonly providerName = 'gemini';
  private readonly logger = new Logger(GeminiAdapter.name);
  private readonly apiKey: string | null;
  private readonly defaultModel: string;

  constructor(config: ConfigService<EnvConfig, true>) {
    const apiKey = config.get('GEMINI_API_KEY', { infer: true }) ?? null;
    this.apiKey = apiKey && apiKey.length > 0 ? apiKey : null;
    this.defaultModel =
      config.get('GEMINI_MODEL', { infer: true }) ?? DEFAULT_MODEL;

    if (!this.apiKey) {
      this.logger.warn(
        'GeminiAdapter: GEMINI_API_KEY missing — adapter is unhealthy and will be skipped.',
      );
    }
  }

  isHealthy(): boolean {
    return this.apiKey !== null;
  }

  async complete(request: AiAdapterRequest): Promise<AiAdapterResponse> {
    if (!this.apiKey) {
      throw new AiUpstreamError(
        null,
        'GeminiAdapter not configured (missing GEMINI_API_KEY)',
      );
    }

    // Gemini understands its own model names only. Anything that looks
    // like a Claude model (or any non-Gemini name) maps to the
    // configured Gemini default so the call always lands on a model
    // Gemini understands — mirrors how `OpenAiAdapter` maps claude-*
    // to its default.
    const modelName = request.modelName.startsWith('gemini')
      ? request.modelName
      : this.defaultModel;

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxTokens,
    };
    if (request.temperature !== undefined) {
      generationConfig.temperature = clamp01(request.temperature);
    }
    if (request.jsonMode) {
      generationConfig.responseMimeType = 'application/json';
    }

    const body = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.user }] }],
      generationConfig,
    };

    const url = `${GEMINI_BASE_URL}/${modelName}:generateContent?key=${encodeURIComponent(
      this.apiKey,
    )}`;

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Primary auth is the `?key=` query param above; the header
          // is sent too so OAuth-style keys also work.
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new AiUpstreamError(
        null,
        `gemini network error: ${(error as Error).message}`,
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
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };

    const text =
      json.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim() ?? '';

    return {
      text,
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs,
      modelName,
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
