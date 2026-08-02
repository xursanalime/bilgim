import {
  Inject,
  Injectable,
  Logger,
  NestMiddleware,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvConfig } from '../../../config/config.module';
import { resolveTraceId } from '../../observability/trace-context';

/**
 * Lightweight Express-style request shape used by the WAF middleware.
 * We intentionally avoid pulling `@types/express` into the import graph
 * so this file compiles cleanly under the platform-express transitive
 * types as well as in unit-test stubs.
 */
export interface WafRequest {
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
}

export interface WafResponse {
  headersSent?: boolean;
  status: (code: number) => WafResponse;
  json: (body: unknown) => WafResponse;
  setHeader?: (name: string, value: string) => unknown;
}

export type WafNext = (err?: unknown) => void;

/**
 * One signature rule. Patterns are kept deliberately narrow so the
 * application middleware does not produce a wave of false positives
 * for content that legitimately mentions SQL keywords or HTML.
 */
export interface WafRule {
  /** Stable rule name surfaced in logs and the 403 envelope. */
  readonly name: string;
  /** Compiled regex evaluated against the request inspection target. */
  readonly pattern: RegExp;
}

/**
 * Sources of every signature we currently match. Bundling these as a
 * static table makes the middleware easy to test, audit and extend.
 *
 * The patterns mirror the wording of Task 27.1:
 *
 *   - SQL injection: `UNION SELECT`, `' OR '1'='1`, `DROP TABLE`,
 *     `keyword … FROM/INTO/TABLE/WHERE` chains, stacked queries.
 *   - XSS: `<script>`, `javascript:`, `on{event}=` handlers (load,
 *     click, error, mouseover, focus, blur, …).
 *   - Path traversal: `../`, `..\\`, and the obvious URL-encoded
 *     variants (`%2e%2e%2f`, `..%2f`, `%2e%2e\`).
 *   - Command injection: `; rm`, `| cat`, `& wget`, `; curl`,
 *     `; sh`, `; bash` — the shell-chain probes that show up in
 *     real-world fuzzers.
 *
 * Each rule's `name` is intentionally machine-readable
 * (`category.specific_pattern`) so SOC dashboards can group counts.
 */
export const WAF_RULES: ReadonlyArray<WafRule> = [
  // ---- SQL injection ------------------------------------------------
  // `UNION SELECT` — the canonical UNION-based exfiltration probe.
  // Fires regardless of what follows the keyword pair, because the
  // pair itself in user input is overwhelmingly malicious.
  {
    name: 'sql_injection.union_select',
    pattern: /\bunion\s+(?:all\s+)?select\b/i,
  },
  // `DROP TABLE` — destructive DDL probe.
  {
    name: 'sql_injection.drop_table',
    pattern: /\bdrop\s+table\b/i,
  },
  // `' OR '1'='1` — classic boolean-tautology bypass. We accept any
  // mix of single / double / backtick quoting and any whitespace
  // because attackers love to obfuscate around the WAF.
  {
    name: 'sql_injection.boolean_or',
    pattern: /['"`]\s*or\s*['"`]?\s*\d+\s*['"`]?\s*=\s*['"`]?\s*\d+/i,
  },
  // `keyword … FROM|INTO|TABLE|WHERE` — looser keyword chain for
  // payloads like `delete users where id=1` or `select id from users`.
  // Accepts up to ~80 chars between the keyword and the connector so
  // a column name in the middle (`select id, name from users`) still
  // matches. The look-around is bounded to avoid catastrophic
  // backtracking.
  {
    name: 'sql_injection.keyword_chain',
    pattern:
      /\b(?:union|select|drop|insert|update|delete)\b[^;\n]{0,80}?\b(?:from|into|table|where)\b/i,
  },
  // Stacked-query probe — `; SELECT …`, `; DROP …` inside a payload.
  {
    name: 'sql_injection.stacked_query',
    pattern:
      /;\s*(?:select|insert|update|delete|drop|alter|truncate)\b/i,
  },

  // ---- XSS ---------------------------------------------------------
  {
    name: 'xss.script_or_handler',
    pattern:
      /<\s*script\b|javascript\s*:|on(?:load|click|error|mouseover|focus|blur|submit|change|keydown|keyup)\s*=/i,
  },
  // <iframe src="javascript:|data:"> — split out so the audit log can
  // distinguish an inline-handler probe from an embedded-frame probe.
  {
    name: 'xss.iframe_src',
    pattern: /<\s*iframe\b[^>]*src\s*=\s*['"]?(?:javascript:|data:)/i,
  },

  // ---- Path traversal ----------------------------------------------
  // ../ or \..\\ — including a few of the obvious encoded variants
  // that show up in real-world probes.
  {
    name: 'path_traversal.dotdot',
    pattern: /\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\.\.%2f|%2e%2e%5c/i,
  },
  // Direct probes for sensitive Unix files (matches even without the
  // dotdot prefix, e.g. `/etc/passwd` referenced anywhere in the URL).
  {
    name: 'path_traversal.sensitive_path',
    pattern: /\/etc\/(?:passwd|shadow|hosts)\b/i,
  },

  // ---- Command injection -------------------------------------------
  {
    name: 'command_injection.shell_chain',
    pattern: /[;|&]\s*(?:rm|cat|wget|curl|sh|bash)\s/i,
  },
];

/**
 * Token injected into the middleware constructor to swap the rule set
 * out under test. When undefined the middleware uses {@link WAF_RULES}.
 */
export const WAF_RULES_TOKEN = Symbol('WAF_RULES_TOKEN');

/**
 * HTTP methods the API accepts. Anything else (TRACE, CONNECT, custom
 * verbs) is rejected at the WAF layer with `WAF_METHOD_NOT_ALLOWED`.
 *
 * `OPTIONS` is included because the CORS preflight uses it; the
 * `configureSecurity` helper handles the actual preflight response,
 * but the WAF must still let the request through to that handler.
 */
export const WAF_ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
]);

/**
 * Total header-bytes budget per request. Anything above this is
 * rejected with `WAF_HEADERS_TOO_LARGE`. The value matches the task
 * spec wording (>8 KiB) and is well below any legitimate browser /
 * mobile client request — the largest header we expect in steady
 * state is a JWT cookie at ~2 KiB.
 *
 * Slow-loris-style attacks that drip oversized header lines are
 * already short-circuited by the body-parser timeout in `main.ts`
 * (`REQUEST_TIMEOUT_MS`); this check is the synchronous companion
 * that catches the ones that arrive in a single chunk.
 */
export const WAF_HEADER_BYTES_LIMIT = 8 * 1024;

/**
 * Logical surface that produced the match. Surfaced in the structured
 * log line so a SOC analyst can pivot quickly.
 */
type WafMatchSurface = 'url' | 'query' | 'body' | 'headers';

/**
 * Why the WAF rejected a request — used to pick the right envelope
 * code without tangling the rule table with non-signature checks
 * (header size, method whitelist).
 */
type WafBlockReason =
  | { kind: 'rule'; rule: WafRule; surface: WafMatchSurface }
  | { kind: 'oversized_headers'; bytes: number }
  | { kind: 'method_not_allowed'; method: string };

/**
 * Application-layer WAF middleware (Task 27.1, Req 27.1).
 *
 * Runs in front of every controller route except `/health` and
 * `/metrics` (those are excluded by the wiring in `AppModule`).
 *
 * Behaviour:
 *   - Rejects HTTP methods outside the `GET/POST/PUT/PATCH/DELETE/
 *     OPTIONS/HEAD` whitelist (catches `TRACE`, `CONNECT`, …) with
 *     `405 WAF_METHOD_NOT_ALLOWED`.
 *   - Rejects requests whose total header bytes exceed
 *     `WAF_HEADER_BYTES_LIMIT` (8 KiB) with `431 WAF_HEADERS_TOO_LARGE`.
 *   - Builds an inspection target from the request URL, query and
 *     body. The Authorization and Cookie headers are deliberately
 *     excluded so secrets never end up in either the inspection
 *     regex run or the audit log.
 *   - Iterates the rule table; the first match wins.
 *   - On match, responds with `403 { code: WAF_BLOCKED, ruleName }`
 *     and a `traceId` for correlation. **The matched payload is
 *     never echoed back** — the response body only carries the
 *     sanitised rule name.
 *   - Logs the violation at WARN level with `{ traceId, ruleName,
 *     clientIp, surface, method, url }`.
 *   - Skips the entire pipeline when `WAF_ENABLED=false` (the
 *     dev-friendly default — see `env.schema.ts`).
 */
@Injectable()
export class WafMiddleware implements NestMiddleware {
  private readonly logger = new Logger(WafMiddleware.name);
  private readonly rules: ReadonlyArray<WafRule>;

  constructor(
    @Optional() private readonly config?: ConfigService<EnvConfig, true>,
    @Optional()
    @Inject(WAF_RULES_TOKEN)
    rules?: ReadonlyArray<WafRule>,
  ) {
    this.rules = rules ?? WAF_RULES;
  }

  use(req: WafRequest, res: WafResponse, next: WafNext): void {
    if (!this.isEnabled()) {
      return next();
    }

    // The interceptor / logging chain may not have stamped the trace
    // id yet (this middleware runs before the global LoggingInterceptor),
    // so resolve it ourselves and reuse the existing one if present.
    const traceId = req.traceId ?? resolveTraceId(req.headers ?? {});
    req.traceId = traceId;

    const reason = this.evaluate(req);
    if (!reason) {
      return next();
    }

    this.respondToBlock(req, res, traceId, reason);
  }

  /**
   * Defaults: off in development / test, on in production. Operators
   * can flip the toggle explicitly with `WAF_ENABLED=true|false`.
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

  /**
   * Evaluate the request against every check, returning the first
   * reason that fires. Order matters:
   *
   *   1. HTTP method whitelist — cheapest test and a cheap-to-respond
   *      `405`. No regexes ever run for a `TRACE` probe.
   *   2. Total header byte budget — enforces the 8 KiB cap before any
   *      body-shaped inspection is attempted.
   *   3. Signature rule table — URL → query → body → headers.
   */
  private evaluate(req: WafRequest): WafBlockReason | null {
    const methodViolation = this.checkMethod(req);
    if (methodViolation) return methodViolation;

    const headerViolation = this.checkHeaderBytes(req);
    if (headerViolation) return headerViolation;

    const ruleMatch = this.findFirstRuleMatch(req);
    if (ruleMatch) return ruleMatch;

    return null;
  }

  private checkMethod(req: WafRequest): WafBlockReason | null {
    const method = (req.method ?? '').toUpperCase();
    if (!method) return null;
    if (WAF_ALLOWED_METHODS.has(method)) return null;
    return { kind: 'method_not_allowed', method };
  }

  private checkHeaderBytes(req: WafRequest): WafBlockReason | null {
    const headers = req.headers;
    if (!headers) return null;
    let total = 0;
    for (const [name, value] of Object.entries(headers)) {
      total += Buffer.byteLength(name, 'utf8');
      if (Array.isArray(value)) {
        for (const v of value) total += Buffer.byteLength(String(v), 'utf8');
      } else if (value !== undefined) {
        total += Buffer.byteLength(String(value), 'utf8');
      }
      if (total > WAF_HEADER_BYTES_LIMIT) {
        return { kind: 'oversized_headers', bytes: total };
      }
    }
    return null;
  }

  /**
   * Walk every relevant request surface and return the first rule
   * that fires, or `null` when nothing matches.
   */
  private findFirstRuleMatch(req: WafRequest): WafBlockReason | null {
    const surfaces: Array<{ surface: WafMatchSurface; value: string }> = [
      { surface: 'url', value: composeUrlTarget(req) },
      { surface: 'query', value: stringify(req.query) },
      { surface: 'body', value: stringify(req.body) },
      { surface: 'headers', value: composeHeaderTarget(req.headers) },
    ];

    for (const { surface, value } of surfaces) {
      if (!value) continue;
      for (const rule of this.rules) {
        if (rule.pattern.test(value)) {
          return { kind: 'rule', rule, surface };
        }
      }
    }
    return null;
  }

  /**
   * Emit the 4xx envelope, set `X-Trace-Id` for client-side
   * correlation, and write the WARN audit-log line. The matched
   * payload is never echoed back — only the sanitised rule name and
   * the trace id reach the response body.
   */
  private respondToBlock(
    req: WafRequest,
    res: WafResponse,
    traceId: string,
    reason: WafBlockReason,
  ): void {
    const clientIp = extractClientIp(req);
    const method = req.method ?? 'GET';
    const url = sanitiseUrl(req);

    if (reason.kind === 'rule') {
      this.logger.warn({
        message: 'WAF rule violated',
        traceId,
        ruleName: reason.rule.name,
        clientIp,
        surface: reason.surface,
        method,
        url,
      });

      writeBlockResponse(res, traceId, 403, {
        error: {
          code: 'WAF_BLOCKED',
          message: 'Request blocked by security policy',
          ruleName: reason.rule.name,
          traceId,
        },
      });
      return;
    }

    if (reason.kind === 'oversized_headers') {
      this.logger.warn({
        message: 'WAF oversized headers',
        traceId,
        clientIp,
        bytes: reason.bytes,
        limitBytes: WAF_HEADER_BYTES_LIMIT,
        method,
        url,
      });

      writeBlockResponse(res, traceId, 431, {
        error: {
          code: 'WAF_HEADERS_TOO_LARGE',
          message: 'Request blocked by security policy',
          limitBytes: WAF_HEADER_BYTES_LIMIT,
          traceId,
        },
      });
      return;
    }

    // Method not allowed
    this.logger.warn({
      message: 'WAF method not allowed',
      traceId,
      clientIp,
      method: reason.method,
      url,
    });

    writeBlockResponse(res, traceId, 405, {
      error: {
        code: 'WAF_METHOD_NOT_ALLOWED',
        message: 'Request blocked by security policy',
        method: reason.method,
        traceId,
      },
    });
  }
}

// =====================================================================
// Helpers — kept module-private so they're easy to verify in unit tests
// without exposing internals.
// =====================================================================

/**
 * Build the URL string the WAF inspects. We prefer `originalUrl`
 * (untouched by Nest's global prefix rewrite), fall back to `url`,
 * and append a single decoded form so URL-encoded payloads
 * (`%3Cscript%3E`) match the same rule as their decoded form.
 */
function composeUrlTarget(req: WafRequest): string {
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
 * never feed either the rule engine or the log line, and we drop
 * the `User-Agent` here because the rule table is biased toward
 * payload-shaped matches — UA-only signatures live in the
 * `ThreatProtectionService`. Including the UA would cause a noisy
 * false positive on any legitimate browser.
 */
function composeHeaderTarget(
  headers: Record<string, string | string[] | undefined> | undefined,
): string {
  if (!headers) return '';
  const parts: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie') continue;
    if (lower === 'user-agent') continue;
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
 * Extract the client IP using the same precedence rules as the
 * `RateLimitInterceptor` so a single user is bucketed identically
 * by both layers.
 */
function extractClientIp(req: WafRequest): string {
  // SECURITY: trust ONLY the IP Express derived under `trust proxy =
  // 'loopback'` (req.ip), plus the raw socket address as a fallback. A
  // client-supplied `X-Forwarded-For` must never override this, or an
  // attacker could rotate the header to evade the WAF's per-IP rate
  // limiting. The header is consulted only when no connection IP exists at
  // all (non-Express unit-test stubs).
  const direct =
    req.ip ?? req.connection?.remoteAddress ?? req.socket?.remoteAddress;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const forwarded = req.headers?.['x-forwarded-for'];
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
 * Sanitise the URL surfaced in the structured log. The path is fine
 * to keep, but we strip the query string because attackers love to
 * stuff payloads in there and we don't want the logger to echo the
 * raw payload.
 */
function sanitiseUrl(req: WafRequest): string {
  const raw = req.originalUrl ?? req.url ?? req.path ?? '';
  if (!raw) return '';
  const idx = raw.indexOf('?');
  return idx >= 0 ? raw.slice(0, idx) : raw;
}

/**
 * Write a 4xx envelope without calling `next()`. Sets `X-Trace-Id`
 * for client-side correlation. No-op when the response has already
 * started — that means an upstream layer already wrote a body and
 * any second write would corrupt the stream.
 */
function writeBlockResponse(
  res: WafResponse,
  traceId: string,
  status: number,
  body: Record<string, unknown>,
): void {
  if (res.headersSent) return;
  if (typeof res.setHeader === 'function') {
    try {
      res.setHeader('X-Trace-Id', traceId);
    } catch {
      /* socket already closed */
    }
  }
  res.status(status).json(body);
}
