/**
 * Adapter-level types — what the AI Gateway expects every provider
 * adapter to satisfy.
 *
 * Adapters MUST be:
 *   - Provider-agnostic at the call boundary (no Anthropic SDK types
 *     leak past `AiAdapter`).
 *   - Idempotent in their public methods — the gateway is responsible
 *     for retry / fallback orchestration.
 *   - Side-effect free apart from the network call. They do NOT write
 *     to the DB and do NOT emit metrics — that's the gateway's job.
 */

/**
 * Provider request — flat string prompt + optional system text. We
 * intentionally avoid exposing the full multi-turn message array
 * because the gateway only ever sends single-turn prompts; multi-turn
 * conversations are out of scope for the platform.
 */
export interface AiAdapterRequest {
  /** Provider model name (e.g. `claude-3-5-sonnet-latest`, `gpt-4o-mini`). */
  modelName: string;
  /** System prompt — policy + persona text. */
  system: string;
  /** Rendered user prompt (template + variables already substituted). */
  user: string;
  /** Hard cap on output tokens. Adapter MUST honour this. */
  maxTokens: number;
  /** Optional sampling temperature (0..1). Adapter may clamp. */
  temperature?: number;
  /**
   * When `true`, instructs the adapter to ask the provider for a
   * strict JSON object response. Adapters that do not support this
   * natively SHOULD inject a "respond with valid JSON only" suffix
   * into the system prompt.
   */
  jsonMode?: boolean;
}

export interface AiAdapterResponse {
  /** Plain-text reply (or stringified JSON when `jsonMode` was set). */
  text: string;
  /** Token usage, used by the cost calculator. */
  inputTokens: number;
  outputTokens: number;
  /** Wall-clock latency of the underlying network call in ms. */
  latencyMs: number;
  /** The model name the provider actually billed against. */
  modelName: string;
}

/**
 * Adapter port. Every provider implementation (Anthropic, OpenAI, fake)
 * implements this exact interface so the gateway can swap them at
 * runtime via DI.
 */
export interface AiAdapter {
  /** Stable identifier used in logs / metrics. */
  readonly providerName: string;
  /**
   * Whether this adapter is configured and healthy enough to take
   * traffic. Returning `false` causes the gateway to skip it. We don't
   * make this async because the gateway already wraps every call in a
   * try/catch — this is purely the bootstrap-time health gate.
   */
  isHealthy(): boolean;
  /**
   * Issue a single completion request. MUST throw `AiUpstreamError`
   * (or a subclass) on provider failure so the gateway can decide
   * whether to fall back.
   */
  complete(request: AiAdapterRequest): Promise<AiAdapterResponse>;
}
