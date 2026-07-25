import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../../../infra/redis/redis.service';
import { BehavioralService } from './behavioral.service';
import { FingerprintService } from './fingerprint.service';
import type {
  BotDecision,
  BotDetectionRequest,
  BotEvaluation,
} from './types';

/**
 * `BotDetectionService` — Task 27.4 (Req 27.6) per-request bot
 * likelihood scorer.
 *
 * Composes five independent signal sources and returns a single
 * `{ score, signals, decision }` triple. The score lives in `[0, 1]`
 * and is the maximum across two views (sum-of-weights vs. strongest
 * individual signal), capped at `1`. The two-view aggregation matters:
 * a single overwhelming signal (a `sqlmap` UA) should be enough to
 * BLOCK by itself, even before the other heuristics are checked.
 *
 * ## Signal sources
 *
 *   1. **User-Agent reputation** — known scanner UAs (`sqlmap`,
 *      `nikto`, `masscan`, `acunetix`, …), headless markers
 *      (`headlesschrome`, `phantomjs`, `playwright`), and missing
 *      User-Agent. Mirrors but extends the WAF's
 *      `suspicious.scanner_user_agent` rule (Task 27.1).
 *
 *   2. **Request timing** — Redis-tracked sliding count of requests
 *      from the same IP within a 1-second window. > 10 reqs / 100ms
 *      from one source is implausible for a human.
 *
 *   3. **Header anomalies** — missing `Accept-Language`, missing
 *      `Accept-Encoding`, browser-impersonating UA without a
 *      `Sec-Fetch-Site` / `Sec-Fetch-Mode` header (real Chrome ≥80
 *      always sends them). Each contributes a small weight; the
 *      combination crosses the CHALLENGE band.
 *
 *   4. **Fingerprint stability** — when an `X-Device-Fingerprint`
 *      hash is present, look up `FingerprintService` for cardinality
 *      anomalies (same fingerprint → many users / many IPs).
 *
 *   5. **WAF challenge marker** — when `req.wafChallenge` is set by
 *      `SecurityWafMiddleware` (Task 27.1), contribute a strong
 *      weight. The WAF flagged the request as ambiguous and we want
 *      the bot detector to step the user up unless they're already
 *      an established session.
 *
 *   6. **Behavioral summary** — when the session previously POSTed
 *      `/security/behavior/report`, blend the stored heuristic score
 *      from `BehavioralService`.
 *
 * ## Decision thresholds (per task body)
 *
 *   - `score >= 0.85` → `BLOCK`
 *   - `0.5 <= score < 0.85` → `CHALLENGE`
 *   - `score < 0.5` → `ALLOW`
 *
 * ## Storage layout (Redis)
 *
 * | Key                   | Type | TTL  | Purpose |
 * |-----------------------|------|------|---------|
 * | `bd:rate:<ip>`        | str  | 1 s  | Sliding 1s request counter per IP |
 *
 * ## Fail-open posture
 *
 * Same as the rest of Phase 10 — every Redis hit is `try/catch`ed
 * and a Redis outage means the timing signal contributes 0.
 */
@Injectable()
export class BotDetectionService {
  private readonly logger = new Logger(BotDetectionService.name);

  // ----- Tunables (exported as static so tests / dashboards share them) ---

  /**
   * Default `score >= BLOCK_THRESHOLD` → `BLOCK` (403 BOT_DETECTED).
   * Overridable per-instance via `BOT_DETECTION_BLOCK_THRESHOLD`.
   */
  static readonly BLOCK_THRESHOLD = 0.85;

  /**
   * Default `score >= CHALLENGE_THRESHOLD` → `CHALLENGE` (require captcha).
   * Overridable per-instance via `BOT_DETECTION_CHALLENGE_THRESHOLD`.
   */
  static readonly CHALLENGE_THRESHOLD = 0.5;

  /** Sliding window for per-IP request rate, in seconds. */
  static readonly RATE_WINDOW_SEC = 1;

  /** Per-IP requests per `RATE_WINDOW_SEC` that flip a strong signal. */
  static readonly BURST_THRESHOLD = 10;

  /** Redis key prefix for the rate counter. */
  static readonly KEY_PREFIX = 'bd:rate';

  /**
   * Header that carries the client-computed device fingerprint hash.
   * Lower-cased here because most HTTP frameworks normalise headers
   * to lower-case before delivery.
   */
  static readonly FINGERPRINT_HEADER = 'x-device-fingerprint';

  /**
   * Header that carries the active client session id used by the
   * behavioural collector.
   */
  static readonly SESSION_HEADER = 'x-session-id';

  /**
   * Per-signal weights. Tuned so that:
   *   - a single overwhelming signal (UA in `STRONG_BOT_UAS`) wins by
   *     itself (`score >= 0.85` → BLOCK).
   *   - two moderate signals combined cross the CHALLENGE threshold.
   *   - one moderate signal alone stays under CHALLENGE.
   */
  static readonly WEIGHTS = {
    UA_KNOWN_BOT: 0.95,
    UA_HEADLESS: 0.55,
    UA_MISSING: 0.4,
    TIMING_BURST: 0.5,
    HEADER_NO_ACCEPT_LANGUAGE: 0.2,
    HEADER_NO_ACCEPT_ENCODING: 0.2,
    HEADER_NO_SEC_FETCH: 0.15,
    FINGERPRINT_ANOMALY: 0.5,
    WAF_CHALLENGE: 0.5,
  } as const;

  /**
   * Known-bot UA fragments. The list intentionally overlaps with the
   * WAF's `suspicious.scanner_user_agent` rule so a request that
   * trips the WAF also trips the bot detector — the two signals
   * compound rather than competing.
   */
  static readonly STRONG_BOT_UAS = [
    'sqlmap',
    'nikto',
    'nessus',
    'masscan',
    'acunetix',
    'nmap',
    'w3af',
    'burpsuite',
  ] as const;

  /** Headless / automation framework markers. */
  static readonly HEADLESS_UAS = [
    'headlesschrome',
    'phantomjs',
    'puppeteer',
    'playwright',
    'selenium',
    'webdriver',
  ] as const;

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly fingerprints?: FingerprintService,
    @Optional() private readonly behavioral?: BehavioralService,
    @Optional() configService?: ConfigService,
  ) {
    // Resolve env-overridable thresholds. Falls back to the class-level
    // defaults when the ConfigService is absent (unit tests construct
    // the service directly without a Nest module).
    const blockRaw = configService?.get<number>(
      'BOT_DETECTION_BLOCK_THRESHOLD',
    );
    const challengeRaw = configService?.get<number>(
      'BOT_DETECTION_CHALLENGE_THRESHOLD',
    );
    let block = clamp01(
      typeof blockRaw === 'number' && Number.isFinite(blockRaw)
        ? blockRaw
        : BotDetectionService.BLOCK_THRESHOLD,
    );
    let challenge = clamp01(
      typeof challengeRaw === 'number' && Number.isFinite(challengeRaw)
        ? challengeRaw
        : BotDetectionService.CHALLENGE_THRESHOLD,
    );
    if (challenge > block) {
      // Defensive: a misconfigured pair flips the decision logic
      // upside down. Log once and snap challenge ≤ block so the
      // service remains predictable.
      this.logger.warn(
        `BOT_DETECTION_CHALLENGE_THRESHOLD (${challenge}) > BOT_DETECTION_BLOCK_THRESHOLD (${block}); clamping`,
      );
      challenge = block;
    }
    this.blockThreshold = block;
    this.challengeThreshold = challenge;
  }

  /** Effective BLOCK threshold (env-overridable). */
  private readonly blockThreshold: number;

  /** Effective CHALLENGE threshold (env-overridable). */
  private readonly challengeThreshold: number;

  /** Read-only accessor for the effective BLOCK threshold. */
  get effectiveBlockThreshold(): number {
    return this.blockThreshold;
  }

  /** Read-only accessor for the effective CHALLENGE threshold. */
  get effectiveChallengeThreshold(): number {
    return this.challengeThreshold;
  }

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Evaluate a request and return a structured `{ score, signals,
   * decision }`. Async because timing and fingerprint anomaly
   * lookups go to Redis.
   *
   * The method is intentionally side-effect-free apart from
   * incrementing the per-IP rate counter — all other signal sources
   * read state populated elsewhere (the WAF middleware, the
   * fingerprint controller, the behavioural controller). That
   * separation keeps the request-time evaluation cheap.
   */
  async evaluate(request: BotDetectionRequest): Promise<BotEvaluation> {
    const signals: string[] = [];
    let weightedSum = 0;
    let strongest = 0;

    const apply = (id: string, weight: number) => {
      signals.push(id);
      weightedSum += weight;
      if (weight > strongest) strongest = weight;
    };

    // 1) User-Agent reputation -----------------------------------------
    const userAgent = (extractHeader(request.headers, 'user-agent') ?? '')
      .trim()
      .toLowerCase();
    if (!userAgent) {
      apply('ua.missing', BotDetectionService.WEIGHTS.UA_MISSING);
    } else {
      if (BotDetectionService.STRONG_BOT_UAS.some((token) => userAgent.includes(token))) {
        apply('ua.known_bot', BotDetectionService.WEIGHTS.UA_KNOWN_BOT);
      } else if (
        BotDetectionService.HEADLESS_UAS.some((token) => userAgent.includes(token))
      ) {
        apply('ua.headless', BotDetectionService.WEIGHTS.UA_HEADLESS);
      }
    }

    // 2) Request timing -----------------------------------------------
    const ip = extractClientIp(request);
    if (ip && ip !== 'unknown') {
      const rate = await this.bumpRequestCounter(ip);
      if (rate > BotDetectionService.BURST_THRESHOLD) {
        apply('timing.burst', BotDetectionService.WEIGHTS.TIMING_BURST);
      }
    }

    // 3) Header anomalies ---------------------------------------------
    const headers = request.headers ?? {};
    if (!extractHeader(headers, 'accept-language')) {
      apply(
        'headers.missing_accept_language',
        BotDetectionService.WEIGHTS.HEADER_NO_ACCEPT_LANGUAGE,
      );
    }
    if (!extractHeader(headers, 'accept-encoding')) {
      apply(
        'headers.missing_accept_encoding',
        BotDetectionService.WEIGHTS.HEADER_NO_ACCEPT_ENCODING,
      );
    }
    if (
      userAgent &&
      // Real Chrome / Firefox / Safari ≥ 80 always send these. A UA
      // that claims to be one of those without the metadata is
      // suspicious.
      isBrowserUa(userAgent) &&
      !extractHeader(headers, 'sec-fetch-site') &&
      !extractHeader(headers, 'sec-fetch-mode')
    ) {
      apply(
        'headers.missing_sec_fetch',
        BotDetectionService.WEIGHTS.HEADER_NO_SEC_FETCH,
      );
    }

    // 4) Fingerprint anomaly -----------------------------------------
    const fingerprintHash = (extractHeader(headers, BotDetectionService.FINGERPRINT_HEADER) ?? '')
      .trim();
    if (fingerprintHash && this.fingerprints) {
      try {
        const anomaly = await this.fingerprints.check(fingerprintHash);
        if (anomaly.suspicious) {
          apply(
            'fingerprint.anomaly',
            BotDetectionService.WEIGHTS.FINGERPRINT_ANOMALY,
          );
        }
      } catch (err) {
        this.logger.warn(
          `evaluate: fingerprint lookup failed: ${(err as Error).message}`,
        );
      }
    }

    // 5) WAF challenge marker ----------------------------------------
    if (request.wafChallenge) {
      apply('waf.challenge', BotDetectionService.WEIGHTS.WAF_CHALLENGE);
    }

    // 6) Behavioural summary -----------------------------------------
    const sessionId = (extractHeader(headers, BotDetectionService.SESSION_HEADER) ?? '')
      .trim();
    if (sessionId && this.behavioral) {
      try {
        const summary = await this.behavioral.lookup(sessionId);
        if (summary) {
          const { score: behaviorScore, reasons } = this.behavioral.computeScore(summary);
          if (behaviorScore > 0) {
            // Behavioural score is already in [0, 1] — fold the same
            // value into both views so a strong stored summary can
            // single-handedly cross CHALLENGE.
            weightedSum += behaviorScore;
            if (behaviorScore > strongest) strongest = behaviorScore;
            for (const reason of reasons) signals.push(reason);
          }
        }
      } catch (err) {
        this.logger.warn(
          `evaluate: behavioural lookup failed: ${(err as Error).message}`,
        );
      }
    }

    const score = clamp01(Math.max(weightedSum, strongest));
    return {
      score,
      signals,
      decision: this.decide(score),
    };
  }

  /** Map a numeric score to the discrete decision bucket. */
  decide(score: number): BotDecision {
    if (score >= this.blockThreshold) return 'BLOCK';
    if (score >= this.challengeThreshold) return 'CHALLENGE';
    return 'ALLOW';
  }

  // =====================================================================
  // Internals
  // =====================================================================

  /**
   * Increment the per-IP request counter. Returns the current count
   * inside the 1-second window; on Redis outage returns 0 (fail-open).
   *
   * Uses INCR + EXPIRE because Redis only persists the TTL the first
   * time the key is created — exactly what we want for a sliding
   * 1-second bucket.
   */
  private async bumpRequestCounter(ip: string): Promise<number> {
    if (!this.redis || !ip) return 0;
    try {
      const key = this.rateKey(ip);
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, BotDetectionService.RATE_WINDOW_SEC);
      }
      return count;
    } catch (err) {
      this.logger.warn(
        `bumpRequestCounter: INCR failed for ${ip}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  private rateKey(ip: string): string {
    return `${BotDetectionService.KEY_PREFIX}:${ip}`;
  }
}

// =====================================================================
// Module-private helpers
// =====================================================================

/**
 * Read a single header value, handling array-valued headers and
 * case-insensitive lookups. Returns `undefined` for absent headers
 * and empty strings.
 */
function extractHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  const direct = headers[lower];
  if (direct !== undefined) {
    const value = Array.isArray(direct) ? direct.join(' ') : String(direct);
    return value.length > 0 ? value : undefined;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      const value = Array.isArray(v) ? v.join(' ') : v ? String(v) : '';
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

/**
 * Pull the client IP using the same precedence as the rest of the
 * Phase 10 stack so all layers bucket a single user identically.
 */
function extractClientIp(request: BotDetectionRequest): string {
  // `request.ip` first — the spoofable `x-forwarded-for` header is a
  // fallback only. See `waf.middleware.ts` for the full rationale.
  const direct =
    request.ip ??
    request.connection?.remoteAddress ??
    request.socket?.remoteAddress;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    const first = String(forwarded[0]).split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  return 'unknown';
}

/**
 * `true` when the UA looks like a real browser (Chrome / Firefox /
 * Safari / Edge). Used to gate the `sec-fetch-*` header check —
 * curl / scripts that don't claim to be a browser are exempt.
 */
function isBrowserUa(ua: string): boolean {
  return (
    ua.includes('chrome/') ||
    ua.includes('firefox/') ||
    ua.includes('safari/') ||
    ua.includes('edg/') ||
    ua.includes('edge/')
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
