/**
 * FakeAdapter — deterministic in-process AI provider used by tests
 * and by the `AI_PROVIDER=mock` runtime mode (default in development).
 *
 * Why deterministic:
 *   - Property tests assert exact policy / similarity thresholds.
 *   - Cost-tracking tests assert exact `AiCall.costUsd` values.
 *   - The audit pipeline must be exercised end-to-end without a real
 *     network call to keep CI green.
 *
 * The adapter is a record-and-replay style: tests can hand it a list
 * of canned `AiAdapterResponse` objects (one per consumed call) or a
 * function that maps requests onto responses. Construction defaults
 * fall back to a stable echo-style behaviour so production-mode boots
 * never crash even when the operator forgets to install a provider.
 */

import { Injectable } from '@nestjs/common';

import { AiUpstreamError } from '../ai.errors';
import type {
  AiAdapter,
  AiAdapterRequest,
  AiAdapterResponse,
} from './types';

export interface FakeAdapterOptions {
  /** Stable identifier — used by tests asserting which provider ran. */
  providerName?: string;
  /** Stable model name returned in the response. */
  modelName?: string;
  /**
   * Pre-canned responses, consumed in order. When the queue is empty
   * the adapter falls back to `responder` (or the echo default).
   */
  responses?: AiAdapterResponse[];
  /** Function-style responder — wins over `responses` if provided. */
  responder?: (request: AiAdapterRequest) => AiAdapterResponse | Promise<AiAdapterResponse>;
  /** When `true`, the adapter throws `AiUpstreamError` on every call. */
  alwaysFail?: boolean;
  /** When `true`, `isHealthy()` returns false. */
  unhealthy?: boolean;
}

@Injectable()
export class FakeAdapter implements AiAdapter {
  readonly providerName: string;
  private readonly modelName: string;
  private readonly queue: AiAdapterResponse[];
  private readonly responder?: (
    request: AiAdapterRequest,
  ) => AiAdapterResponse | Promise<AiAdapterResponse>;
  private readonly alwaysFail: boolean;
  private readonly unhealthy: boolean;

  /** Counter consumers can introspect to assert call counts. */
  callCount = 0;
  /** Last request the adapter saw — useful for prompt assertions. */
  lastRequest: AiAdapterRequest | null = null;

  constructor(options: FakeAdapterOptions = {}) {
    this.providerName = options.providerName ?? 'fake';
    this.modelName = options.modelName ?? 'fake-primary';
    this.queue = options.responses ? [...options.responses] : [];
    if (options.responder !== undefined) {
      this.responder = options.responder;
    }
    this.alwaysFail = options.alwaysFail ?? false;
    this.unhealthy = options.unhealthy ?? false;
  }

  isHealthy(): boolean {
    return !this.unhealthy;
  }

  async complete(request: AiAdapterRequest): Promise<AiAdapterResponse> {
    this.callCount += 1;
    this.lastRequest = request;

    if (this.alwaysFail) {
      throw new AiUpstreamError(503, `FakeAdapter:${this.providerName} simulated failure`);
    }

    if (this.responder) {
      const result = await this.responder(request);
      return { ...result, modelName: result.modelName ?? this.modelName };
    }

    const next = this.queue.shift();
    if (next) {
      return { ...next, modelName: next.modelName ?? this.modelName };
    }

    // Default echo response — short, stable, and deterministic so
    // similarity tests don't flake on long random text.
    const text = buildEchoText(request);
    return {
      text,
      inputTokens: estimateTokens(request.system) + estimateTokens(request.user),
      outputTokens: estimateTokens(text),
      latencyMs: 1,
      modelName: this.modelName,
    };
  }
}

function buildEchoText(request: AiAdapterRequest): string {
  if (request.jsonMode) {
    return JSON.stringify({
      reply: 'fake-reply',
      preview: request.user.slice(0, 32),
    });
  }
  return `[fake:${request.modelName}] ${request.user.slice(0, 80)}`.trim();
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text?.length ?? 0) / 4));
}
