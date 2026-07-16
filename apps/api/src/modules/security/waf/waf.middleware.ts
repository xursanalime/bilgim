import {
  Inject,
  Injectable,
  Logger,
  NestMiddleware,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvConfig } from '../../../config/config.module';
import { resolveTraceId } from '../../../common/observability/trace-context';
import { SiemService } from '../siem/siem.service';

import {
  DEFAULT_WAF_RULES,
  type WafEvaluation,
  type WafMatchSurface,
  type WafRule,
} from './waf-rules';

/**
 * Lightweight Express-style request shape consumed by the WAF
 * middleware. Defined locally (instead of importing `@types/express`)
 * so the file compiles cleanly under both real Express and the unit
 * test stubs.
 */
export interface SecurityWafRequest {
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
  traceId?: string;
  /**
   * When a `CHALLENGE`-severity rule fires, the middleware annotates
   * the request so downstream guards (e.g. bot-detection, hCaptcha)
   * can step the user up. `undefined` on every clean request.
   */
  wafChallenge?: {
    ruleId: string;
    category: string;
    surface: WafMatchSurface;
  };
}

export interface SecurityWafResponse {
  headersSent?: boolean;
  status: (code: number) => SecurityWafResponse;
  json: (body: unknown) => SecurityWafResponse;
  setHeader?: (name: string, value: string) => unknown;
}

export type SecurityWafNext = (err?: unknown) => void;

/** DI token for swapping the rule registry under test. */
export const SECURITY_WAF_RULES_TOKEN = Symbol('SECURITY_WAF_RULES');

/** Paths that bypass the rule engine entirely (kubelet probes, scrapes). */
const SKIP_PATH_PREFIXES = [
  '/health',
  '/metrics',
  '/api/v1/health',
  '/api/v1/metrics',
];

/**
 * Application-layer WAF middleware (Task 27.1, Req 27.1).
 *
 * Lives at `apps/api/src/modules/security/waf/waf.middleware.ts`
 * (the path called out explicitly in the task body) and complements
 * the always-on subset already enforced by
 * `common/security/waf/waf.middleware.ts`. The two middlewares cover
 * different concerns:
 *
 *   - The **common** middleware enforces the cheap synchronous
 *     guardrails (HTTP method whitelist, oversized headers, hard-fail
 *     SQLi / XSS / path-traversal patterns) and ships a 4xx envelope
 *     directly. It runs first, on every request, regardless of
 *     environment.
 *   - This **module** middleware adds the SIEM-friendly severity
 *     pipeline: each detection is interpreted as `BLOCK`, `LOG`, or
 *     `CHALLENGE`, and clean requests are still logged when a
 *     lower-severity rule fires so the SOC has visibility on
 *     emerging signatures before they're promoted to BLOCK.
 *
 * Behaviour:
 *
 *   - Skip when `WAF_ENABLED=false` or when `NODE_ENV` is anything
 *     other than `production` (operators can flip the toggle
 *     explicitly to re-enable in dev).
 *   - Build the inspection target from URL + query + body + headers.
 *     Authorization / Cookie / User-Agent are omitted from the body
 *     scan so secrets never feed the regex engine; the User-Agent
 *     gets its own rule under the `SUSPICIOUS` category.
 *   - Walk every rule. If a `BLOCK` rule fires, respond with `403
 *     WAF_RULE_VIOLATION` carrying the `ruleId`, `category`, and
 *     `traceId` for SOC correlation.
 *   - When only `LOG` / `CHALLENGE` rules fire, log the detection
 *     and let the request through. `CHALLENGE` matches set
 *     `request.wafChallenge` so downstream layers can step up.
 *
 * **Logging**: every detection emits a single structured line tagged
 * `event=waf.detected` (clean for Loki / SIEM ingestion). The matched
 * payload is **never** echoed in the response or the log line — only
 * the rule id, category, severity, surface, and trace id are
 * surfaced.
 */
@Injectable()
export class SecurityWafMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SecurityWafMiddleware.name);
  private readonly rules: ReadonlyArray<WafRule>;

  constructor(
    @Optional() private readonly config?: ConfigService<EnvConfig, true>,
    @Optional()
    @Inject(SECURITY_WAF_RULES_TOKEN)
    rules?: ReadonlyArray<WafRule>,
    @Optional() private readonly siem?: SiemService,
  ) {
    this.rules = rules ?? DEFAULT_WAF_RULES;
  }

  use(
    req: SecurityWafRequest,
    res: SecurityWafResponse,
    next: SecurityWafNext,
  ): void {
    if (!this.isEnabled()) {
      return next();
    }
    if (this.shouldSkip(req)) {
      return next();
    }

    // The global LoggingInterceptor stamps `req.traceId` later in the
    // pipeline; resolve / mint one here so every audit line is
    // correlatable from the very first checkpoint.
    const traceId = req.traceId ?? resolveTraceId(req.headers ?? {});
    req.traceId = traceId;

    const evaluation = this.evaluate(req);

    // 1) Lower-severity LOG / CHALLENGE detections first — these fire
    //    even when a BLOCK rule also matches, so the SOC can still
    //    see the supporting context.
    for (const detection of evaluation.detections) {
      this.emitDetectionLog(req, traceId, detection.rule, detection.surface);
      this.emitSiemDetected(req, traceId, detection.rule, detection.surface);
      if (detection.rule.severity === 'CHALLENGE' && !req.wafChallenge) {
        req.wafChallenge = {
          ruleId: detection.rule.id,
          category: detection.rule.category,
          surface: detection.surface,
        };
      }
    }

    // 2) BLOCK rule (if any) wins.
    if (evaluation.matched && evaluation.surface) {
      this.emitDetectionLog(
        req,
        traceId,
        evaluation.matched,
        evaluation.surface,
      );
      this.emitSiemBlocked(req, traceId, evaluation.matched, evaluation.surface);
      this.respondBlocked(res, traceId, evaluation.matched);
      return;
    }

    return next();
  }

  // ------------------------------------------------------------------
  // Configuration helpers
  // ------------------------------------------------------------------

  /**
   * Defaults: off in development / test, on in production. Operators
   * can flip the toggle explicitly with `WAF_ENABLED=true|false` —
   * this is the single source of truth, shared with the common-layer
   * middleware so they always agree.
   */
  private isEnabled(): boolean {
    if (!this.config) return false;
    const explicit = this.config.get('WAF_ENABLED', { infer: true }) as
      | boolean
      | undefined;
    if (typeof explicit === 'boolean') return explicit;
    const env = this.config.get('NODE_ENV', { infer: true });
    return env === 'production';
  }

  private shouldSkip(req: SecurityWafRequest): boolean {
    const raw = req.originalUrl ?? req.url ?? req.path ?? '';
    if (!raw) return false;
    const pathOnly = raw.split('?')[0] ?? '';
    return SKIP_PATH_PREFIXES.some((prefix) => pathOnly.startsWith(prefix));
  }

  // ------------------------------------------------------------------
  // Rule evaluation
  // ------------------------------------------------------------------

  /**
   * Walk every rule against every surface, returning:
   *   - `matched` — first BLOCK rule that fired (or `null`)
   *   - `detections` — every LOG / CHALLENGE rule that fired
   *
   * Order of surfaces is `url → query → body → headers`. We stop
   * recording further BLOCK matches once one fires (the response is
   * already determined), but LOG / CHALLENGE detections are
   * collected from every surface so the SIEM has full context.
   */
  private evaluate(req: SecurityWafRequest): WafEvaluation {
    const surfaces: Array<{ surface: WafMatchSurface; value: string }> = [
      { surface: 'url', value: composeUrlTarget(req) },
      { surface: 'query', value: stringify(req.query) },
      { surface: 'body', value: stringify(req.body) },
      { surface: 'headers', value: composeHeaderTarget(req.headers) },
    ];

    let matched: WafRule | null = null;
    let matchedSurface: WafMatchSurface | null = null;
    const detections: Array<{ rule: WafRule; surface: WafMatchSurface }> = [];

    for (const { surface, value } of surfaces) {
      if (!value) continue;
      for (const rule of this.rules) {
        if (!rule.pattern.test(value)) continue;

        if (rule.severity === 'BLOCK') {
          if (!matched) {
            matched = rule;
            matchedSurface = surface;
          }
          continue;
        }
        // LOG / CHALLENGE — collect for downstream enrichment.
        detections.push({ rule, surface });
      }
    }

    return { matched, surface: matchedSurface, detections };
  }

  // ------------------------------------------------------------------
  // Logging + response
  // ------------------------------------------------------------------

  /**
   * Emit a single structured line for one detection. The `event`
   * field is `waf.detected` for every severity so a Loki / SIEM
   * dashboard can group them; the `severity` field discriminates.
   *
   * The matched payload is intentionally not included — only the
   * rule id, category, severity, surface, sanitised path, method,
   * client IP, and trace id are recorded.
   */
  private emitDetectionLog(
    req: SecurityWafRequest,
    traceId: string,
    rule: WafRule,
    surface: WafMatchSurface,
  ): void {
    this.logger.warn({
      event: 'waf.detected',
      message: `WAF rule ${rule.severity}: ${rule.id}`,
      ruleId: rule.id,
      category: rule.category,
      severity: rule.severity,
      surface,
      method: req.method ?? 'GET',
      path: sanitisePath(req),
      clientIp: extractClientIp(req),
      traceId,
    });
  }

  private respondBlocked(
    res: SecurityWafResponse,
    traceId: string,
    rule: WafRule,
  ): void {
    if (res.headersSent) return;
    if (typeof res.setHeader === 'function') {
      try {
        res.setHeader('X-Trace-Id', traceId);
      } catch {
        /* socket already gone */
      }
    }
    res.status(403).json({
      error: {
        code: 'WAF_RULE_VIOLATION',
        message: 'Request blocked by security policy',
        ruleId: rule.id,
        category: rule.category,
        traceId,
      },
    });
  }

  /**
   * Mirror a `BLOCK` ruling to the SIEM pipeline (Task 27.5,
   * Req 27.7) so coordinated-attack correlation can fold WAF
   * signals together with auth / bot / honeypot signals from the
   * same IP.
   */
  private emitSiemBlocked(
    req: SecurityWafRequest,
    traceId: string,
    rule: WafRule,
    surface: WafMatchSurface,
  ): void {
    if (!this.siem) return;
    const ip = extractClientIp(req);
    void this.siem
      .recordEvent({
        type: 'security.waf.block',
        severity: 'MEDIUM',
        ip,
        traceId,
        payload: {
          ruleId: rule.id,
          category: rule.category,
          surface,
          method: req.method ?? 'GET',
          path: sanitisePath(req),
        },
      })
      .catch((err) =>
        this.logger.warn(
          `emitSiemBlocked: SIEM emit failed: ${(err as Error).message}`,
        ),
      );
  }

  /**
   * Mirror a `LOG` / `CHALLENGE` detection to the SIEM pipeline so
   * the SOC dashboard sees the same supporting context the local
   * Loki line carries.
   */
  private emitSiemDetected(
    req: SecurityWafRequest,
    traceId: string,
    rule: WafRule,
    surface: WafMatchSurface,
  ): void {
    if (!this.siem) return;
    const ip = extractClientIp(req);
    void this.siem
      .recordEvent({
        type: 'security.waf.detected',
        severity: 'LOW',
        ip,
        traceId,
        payload: {
          ruleId: rule.id,
          category: rule.category,
          ruleSeverity: rule.severity,
          surface,
          method: req.method ?? 'GET',
          path: sanitisePath(req),
        },
      })
      .catch((err) =>
        this.logger.warn(
          `emitSiemDetected: SIEM emit failed: ${(err as Error).message}`,
        ),
      );
  }
}

// =====================================================================
// Module-private helpers
// =====================================================================

/**
 * Build the URL string the WAF inspects. Append a single decoded form
 * so URL-encoded payloads (`%3Cscript%3E`) match the same rule as
 * their decoded form.
 */
function composeUrlTarget(req: SecurityWafRequest): string {
  const raw = req.originalUrl ?? req.url ?? req.path ?? '';
  if (!raw) return '';
  let decoded: string | null = null;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = null;
  }
  return decoded && decoded !== raw ? `${raw} ${decoded}` : raw;
}

/**
 * Render the request's headers into a single string we can run the
 * WAF rules against. We strip Authorization and Cookie so secrets
 * never feed either the rule engine or the log line. The User-Agent
 * is included because we have a dedicated `suspicious.scanner_user_agent`
 * rule scanning for known-bad scanners.
 */
function composeHeaderTarget(
  headers: Record<string, string | string[] | undefined> | undefined,
): string {
  if (!headers) return '';
  const parts: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie') continue;
    if (Array.isArray(value)) parts.push(value.join(' '));
    else if (value) parts.push(String(value));
  }
  return parts.join(' ');
}

/**
 * Stringify any value we receive on the request body / query.
 * Defensive against circular references — falls back to a string
 * coerced through `String()`.
 */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Extract the client IP using the same precedence as the rest of the
 * stack so all layers bucket a single user identically.
 */
function extractClientIp(req: SecurityWafRequest): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    const first = String(forwarded[0]).split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  return (
    req.ip ??
    req.connection?.remoteAddress ??
    req.socket?.remoteAddress ??
    'unknown'
  );
}

/** Sanitise URL for logging — strip query string. */
function sanitisePath(req: SecurityWafRequest): string {
  const raw = req.originalUrl ?? req.url ?? req.path ?? '';
  if (!raw) return '';
  const idx = raw.indexOf('?');
  return idx >= 0 ? raw.slice(0, idx) : raw;
}
