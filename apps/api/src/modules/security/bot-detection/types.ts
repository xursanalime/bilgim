/**
 * Shared types for the bot-detection module (Task 27.4, Req 27.6).
 *
 * Centralised here so the service, guard, controller, and tests all
 * agree on the shape without circular imports.
 */
import type { WafMatchSurface } from '../waf/waf-rules';

/**
 * Subset of an Express-style request the bot-detection layer reads.
 * Defined locally so we don't pull `@types/express` into unit tests.
 *
 * Mirrors `SecurityWafRequest` but adds the fields the bot-detection
 * pipeline annotates as it walks the request:
 *   - `wafChallenge` (set by `SecurityWafMiddleware`, Task 27.1) — the
 *     WAF flagged the request as ambiguous, contributes a strong
 *     signal here.
 *   - `captchaRequired` (set by this guard) — downstream code paths
 *     treat this as a step-up requirement.
 */
export interface BotDetectionRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: unknown;
  body?: unknown;
  ip?: string;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
  user?: { sub?: string; id?: string } | null;
  /** Annotated by the WAF middleware when a CHALLENGE rule fires. */
  wafChallenge?: {
    ruleId: string;
    category: string;
    surface: WafMatchSurface;
  };
  /** Set by this guard on CHALLENGE so downstream code can step up. */
  captchaRequired?: boolean;
  /** Hard-block reason populated when `decision === 'BLOCK'`. */
  botBlockedReason?: string;
}

/**
 * Outcome bucket. Drives whether the guard returns 200, asks for a
 * captcha, or hard-blocks the request.
 *
 *   - `ALLOW`     — score < 0.5, request proceeds untouched.
 *   - `CHALLENGE` — score in `[0.5, 0.85)`, hCaptcha is required to
 *                   continue. Already-solved captchas pass through.
 *   - `BLOCK`     — score ≥ 0.85, return `403 BOT_DETECTED`.
 */
export type BotDecision = 'ALLOW' | 'CHALLENGE' | 'BLOCK';

/**
 * Score + signal context produced by `BotDetectionService.evaluate`.
 *
 * `signals` is a flat list of human-readable identifiers (e.g.
 * `ua.headless`, `timing.burst`, `headers.missing_accept_language`).
 * They feed structured logs and the SIEM dashboard, and they also let
 * unit tests assert on which heuristics actually fired without
 * coupling to the exact score formula.
 */
export interface BotEvaluation {
  /** Aggregate likelihood the request is a bot, in `[0, 1]`. */
  score: number;
  /** Stable identifiers of every heuristic that fired. */
  signals: string[];
  /** Decision derived from the score thresholds. */
  decision: BotDecision;
}

/**
 * Client-supplied behavioural summary. POSTed to
 * `/security/behavior/report` once per session window so
 * `BotDetectionService` can fold the human-pattern signal into its
 * evaluation.
 *
 * The values are intentionally coarse — we don't want a schema that
 * encourages clients to leak fine-grained interaction traces, only a
 * summary the server can sanity-check.
 */
export interface BehavioralSignals {
  /** Stable session identifier (cookie / localStorage). */
  sessionId: string;
  /** Optional form identifier — used by the SIEM to bucket reports. */
  formId?: string;
  /** Number of mouseover / mousemove events observed in the window. */
  mouseMovements: number;
  /** Number of distinct keystroke events observed in the window. */
  keystrokes: number;
  /** Aggregate dwell time in milliseconds. */
  dwellTime: number;
  /**
   * Time between form rendering and submission, in milliseconds. A
   * value below `BotDetectionService.MIN_HUMAN_FORM_MS` is a strong
   * bot signal, especially when paired with zero mouse movement.
   */
  formCompletionMs: number;
}

/** Stored summary returned to the bot-detection service from Redis. */
export interface StoredBehavioralSummary extends BehavioralSignals {
  /** ISO timestamp the report was received. */
  receivedAt: string;
}

/**
 * Client-supplied device fingerprint. Either sent via the
 * `X-Device-Fingerprint` header or POSTed to
 * `/security/fingerprint/report`. The shape is intentionally narrow —
 * we don't trust the client to be honest and the server only uses it
 * as a stability signal.
 */
export interface DeviceFingerprintPayload {
  /** Client-computed canvas-rendering hash. */
  canvasHash: string;
  /** Comma-joined or pipe-joined font list, lowercased on the server. */
  fonts: string;
  /** Screen resolution in `WIDTHxHEIGHT` form. */
  screen: string;
  /** IANA timezone (`Asia/Tashkent`). */
  timezone: string;
  /** Browser language tag (`en-US`). */
  language: string;
}

/**
 * Result of a fingerprint anomaly check — used by the bot-detection
 * service to drive the score.
 */
export interface FingerprintAnomalyResult {
  /** Stable hash the lookup was keyed on. */
  fingerprintHash: string;
  /** Distinct user / IP combinations seen for this fingerprint inside the window. */
  distinctIdentities: number;
  /** Distinct IPs seen for this fingerprint inside the window. */
  distinctIps: number;
  /** `true` when the cardinality crossed the suspicion threshold. */
  suspicious: boolean;
}
