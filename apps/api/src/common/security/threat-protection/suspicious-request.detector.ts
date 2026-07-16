/**
 * Suspicious-request detector — Task 27.1.
 *
 * Pure, stateless utility that inspects an incoming HTTP request for
 * a small, hand-curated set of attack signatures:
 *
 *   - **SQL injection** — `UNION SELECT`, `OR 1=1`, comment terminators,
 *     stacked queries.
 *   - **XSS** — `<script>` tags, `javascript:` URIs, `on{event}=` handlers,
 *     `<iframe src="javascript:|data:">`.
 *   - **Path traversal** — `../`, `..\\`, and the obvious URL-encoded
 *     variants (`%2e%2e%2f`, `..%2f`, `%2e%2e\`).
 *   - **Excessive header / cookie size** — single header value (or the
 *     `cookie` header) exceeding 16 KiB.
 *
 * The detector is intentionally separate from the middleware that wraps
 * it: this module is plain TypeScript, has no Nest dependency, and is
 * therefore easy to unit-test against a giant table of payloads.
 *
 * The matching surface is built from a fixed list:
 *
 *   1. URL (`originalUrl` ?? `url` ?? `path`) plus its decoded form.
 *   2. The query value, JSON-stringified (no recursion limit — payloads
 *      are already capped by the body-size middleware).
 *   3. The body, JSON-stringified.
 *   4. Headers, with the secret-bearing ones (`authorization`, `cookie`,
 *      `proxy-authorization`) stripped so secrets never feed the rule
 *      engine or the audit log.
 *
 * The function returns `null` for clean traffic and a structured
 * {@link SuspiciousRequestMatch} for the first signature that fires.
 */

export type SuspiciousCategory =
  | 'sql_injection'
  | 'xss'
  | 'path_traversal'
  | 'oversized_headers';

export type SuspiciousSurface =
  | 'url'
  | 'query'
  | 'body'
  | 'headers'
  | 'cookie';

/**
 * One signature rule. Categories share rules so a SOC dashboard can
 * group counts by `category` without parsing rule names.
 */
export interface SuspiciousRule {
  /** Stable identifier surfaced in audit logs / dashboards. */
  readonly name: string;
  readonly category: SuspiciousCategory;
  /** Compiled regex evaluated against the inspection target. */
  readonly pattern: RegExp;
}

export interface SuspiciousRequestMatch {
  readonly rule: SuspiciousRule;
  readonly surface: SuspiciousSurface;
  /**
   * Sanitised slice of the offending value — capped at 200 chars.
   * Used in the audit-log entry and never echoed back to the caller.
   */
  readonly sample: string;
}

/**
 * Subset of an Express request the detector reads. We avoid pulling
 * `@types/express` so the file is portable to non-express test stubs.
 */
export interface InspectableRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: unknown;
  body?: unknown;
}

/**
 * Hard cap (in bytes) for any single header / cookie value.
 *
 * The `cookie` header is checked separately because an oversize cookie
 * jar is the more common abuse vector — the platform issues a single
 * HttpOnly session cookie, so anything north of 16 KiB is suspicious.
 *
 * The same cap applies to every other header — a 64 KiB `User-Agent`
 * is almost always slow-loris-style abuse.
 */
export const SUSPICIOUS_HEADER_LIMIT_BYTES = 16 * 1024; // 16 KiB

/**
 * Headers we never inspect for SQL/XSS/traversal signatures because
 * they routinely carry opaque base64 / random data. Stripping them
 * keeps the false-positive rate manageable and ensures secrets never
 * make it into the audit log.
 */
const SECRET_HEADERS = new Set<string>([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'x-amz-security-token',
]);

/**
 * Headers excluded from the *content* inspection but still subject to
 * the size check. Same rationale as `SECRET_HEADERS`.
 */
const SIZE_ONLY_HEADERS = new Set<string>([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-amz-security-token',
]);

/**
 * Curated rule table. Patterns are kept narrow on purpose — a bare
 * `select` keyword would false-positive on harmless content like
 * "select your favourite language". The structural cues
 * (punctuation + neighbouring keyword) keep us honest.
 */
export const SUSPICIOUS_RULES: ReadonlyArray<SuspiciousRule> = [
  // ---- SQL injection -----------------------------------------------
  {
    name: 'sqli.union_select',
    category: 'sql_injection',
    pattern: /\bunion\s+(all\s+)?select\b/i,
  },
  {
    name: 'sqli.boolean_or',
    category: 'sql_injection',
    pattern: /['"`)\s]\s*or\s+['"`(\s]*\d+\s*=\s*\d+/i,
  },
  {
    name: 'sqli.tautology',
    category: 'sql_injection',
    pattern: /\b(?:and|or)\s+\d+=\d+\s*--/i,
  },
  {
    name: 'sqli.stacked_query',
    category: 'sql_injection',
    pattern:
      /;\s*(?:select|insert|update|delete|drop|alter|truncate)\b/i,
  },
  {
    name: 'sqli.keyword_chain',
    category: 'sql_injection',
    pattern:
      /\b(?:union|select|drop|insert|update|delete)\s+(?:from|into|table|where)\b/i,
  },

  // ---- XSS ---------------------------------------------------------
  {
    name: 'xss.script_tag',
    category: 'xss',
    pattern: /<\s*script\b[^>]*>/i,
  },
  {
    name: 'xss.javascript_uri',
    category: 'xss',
    pattern: /javascript\s*:/i,
  },
  {
    name: 'xss.event_handler',
    category: 'xss',
    pattern: /\bon[a-z]{3,}\s*=\s*['"]?[^'">\s]+/i,
  },
  {
    name: 'xss.iframe_src',
    category: 'xss',
    pattern: /<\s*iframe\b[^>]*src\s*=\s*['"]?(?:javascript:|data:)/i,
  },

  // ---- Path traversal ----------------------------------------------
  {
    name: 'traversal.dotdot_slash',
    category: 'path_traversal',
    pattern: /(?:\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\.\.%2f|%2e%2e%5c)/i,
  },
  {
    name: 'traversal.absolute_unix',
    category: 'path_traversal',
    pattern: /\/etc\/(?:passwd|shadow|hosts)\b/i,
  },
];

/**
 * Inspect the request and return the first matching rule, or `null`
 * for clean traffic. The order of operations is:
 *
 *   1. Check header sizes — cheapest test, eliminates oversized
 *      slow-loris-style probes before any regex runs.
 *   2. Inspect the URL surface (URL + query string in the path).
 *   3. Inspect the explicit `query` object.
 *   4. Inspect the body.
 *   5. Inspect the (filtered) headers.
 *
 * The first match short-circuits the rest.
 */
export function detectSuspiciousRequest(
  req: InspectableRequest,
): SuspiciousRequestMatch | null {
  // 1) Oversized header / cookie check.
  const sizeViolation = findOversizeHeader(req.headers);
  if (sizeViolation) return sizeViolation;

  const surfaces: Array<{ surface: SuspiciousSurface; value: string }> = [
    { surface: 'url', value: composeUrlTarget(req) },
    { surface: 'query', value: stringify(req.query) },
    { surface: 'body', value: stringify(req.body) },
    { surface: 'headers', value: composeHeaderTarget(req.headers) },
  ];

  for (const { surface, value } of surfaces) {
    if (!value) continue;
    for (const rule of SUSPICIOUS_RULES) {
      if (rule.pattern.test(value)) {
        const match = rule.pattern.exec(value);
        return {
          rule,
          surface,
          sample: sanitiseSample(match?.[0] ?? ''),
        };
      }
    }
  }
  return null;
}

// =====================================================================
// Helpers — module-private so they're easy to unit-test through the
// public `detectSuspiciousRequest` surface without polluting the API.
// =====================================================================

function findOversizeHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
): SuspiciousRequestMatch | null {
  if (!headers) return null;
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    const flat = Array.isArray(value) ? value.join('; ') : value ?? '';
    const size = byteLength(flat);
    if (size <= SUSPICIOUS_HEADER_LIMIT_BYTES) continue;
    return {
      rule: {
        name:
          lower === 'cookie'
            ? 'oversized.cookie'
            : `oversized.header:${lower}`,
        category: 'oversized_headers',
        // Sentinel pattern — never used for actual matching, but
        // included so the shape stays consistent with regex-based rules.
        pattern: /^$/,
      },
      surface: lower === 'cookie' ? 'cookie' : 'headers',
      sample: `header=${lower} bytes=${size}`,
    };
  }
  return null;
}

/**
 * Build the URL surface the rule engine inspects. We prefer
 * `originalUrl` (untouched by Nest's global prefix rewrite), fall
 * back to `url` and `path`, and append a single decoded form so
 * URL-encoded payloads (`%3Cscript%3E`) match the same rule as their
 * decoded form.
 */
function composeUrlTarget(req: InspectableRequest): string {
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
 * Render headers into a single inspection string. The set of headers
 * we *never* inspect is centralised in {@link SECRET_HEADERS} so
 * adding a new one is a one-line change.
 */
function composeHeaderTarget(
  headers: Record<string, string | string[] | undefined> | undefined,
): string {
  if (!headers) return '';
  const parts: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (SECRET_HEADERS.has(lower)) continue;
    if (lower === 'user-agent') continue; // inspected separately if at all
    if (Array.isArray(value)) parts.push(value.join(' '));
    else if (value) parts.push(String(value));
  }
  return parts.join(' ');
}

/**
 * Stringify any value so the regex engine can run against it. Defensive
 * against circular references — falls back to `String()` coercion.
 */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * UTF-8 byte length without pulling in `Buffer` directly (which works
 * in Node and the various test stubs without ceremony).
 */
function byteLength(value: string): number {
  if (!value) return 0;
  return Buffer.byteLength(value, 'utf8');
}

function sanitiseSample(value: string): string {
  const trimmed = value.length > 200 ? `${value.slice(0, 197)}...` : value;
  // Strip control characters so a payload with embedded NUL/CR/LF
  // can't break the JSON envelope when we log it.
  return trimmed.replace(/[\u0000-\u001f\u007f]/g, '');
}

/** Re-export for tests that want to assert against the secret-headers set. */
export const _SECRETS_FOR_TEST = {
  SECRET_HEADERS: Array.from(SECRET_HEADERS),
  SIZE_ONLY_HEADERS: Array.from(SIZE_ONLY_HEADERS),
};
