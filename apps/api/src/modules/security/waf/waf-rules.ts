/**
 * WAF rule registry — Task 27.1, Requirement 27.1.
 *
 * Each rule pairs an OWASP Top 10 category with a regex signature and a
 * **severity action**:
 *
 *   - `BLOCK`     — terminate the request immediately with `403
 *                   WAF_RULE_VIOLATION`. Used for high-confidence
 *                   exploit signatures (UNION SELECT, `<script>`,
 *                   `../../etc/passwd`, `;rm -rf`).
 *   - `CHALLENGE` — let the request through but mark it for downstream
 *                   step-up auth / hCaptcha. Reserved for ambiguous
 *                   patterns where the false-positive rate would be
 *                   too high to block outright (the application layer
 *                   doesn't actually serve a CAPTCHA itself — Task
 *                   27.4 owns that — but the marker survives in the
 *                   request so the bot-detection layer can pick it up).
 *   - `LOG`       — record the detection but do not interfere with the
 *                   request. Intended for emerging signatures where
 *                   we want SIEM visibility before raising the
 *                   confidence to BLOCK.
 *
 * The regex set is intentionally narrow. Anything that would routinely
 * fire on legitimate prose (a blog post mentioning "select" or "drop
 * table") lives under `LOG`, not `BLOCK`. The spec is unambiguous about
 * the four categories that MUST be blocked: SQL injection, XSS, path
 * traversal, and RCE / command injection.
 */

/** Severity action — drives the middleware response. */
export type WafSeverity = 'BLOCK' | 'CHALLENGE' | 'LOG';

/** Top-level OWASP grouping surfaced in the structured log line. */
export type WafCategory =
  | 'SQL_INJECTION'
  | 'XSS'
  | 'PATH_TRAVERSAL'
  | 'RCE'
  | 'SUSPICIOUS';

/**
 * One WAF rule. Patterns deliberately use case-insensitive matching
 * so attackers can't dodge the rule by changing the letter case.
 */
export interface WafRule {
  /** Stable machine-readable identifier (`category.specific_pattern`). */
  readonly id: string;
  /** OWASP category this rule belongs to. */
  readonly category: WafCategory;
  /** Severity action — drives the middleware response. */
  readonly severity: WafSeverity;
  /** Regex evaluated against the inspection target. */
  readonly pattern: RegExp;
  /** Human-readable description for SIEM dashboards. */
  readonly description: string;
}

/**
 * Default rule registry. Any rule with `severity: 'BLOCK'` will
 * short-circuit a matching request with `403 WAF_RULE_VIOLATION`.
 *
 * The registry intentionally overlaps with the patterns in
 * `common/security/waf/waf.middleware.ts` (Task 27.1 first pass). That
 * middleware enforces a cheap, always-on subset; this registry adds
 * the severity-tiered interpretation needed for the SIEM-friendly
 * pipeline documented in the task body.
 */
export const DEFAULT_WAF_RULES: ReadonlyArray<WafRule> = [
  // ------------------------------------------------------------------
  // SQL INJECTION
  // ------------------------------------------------------------------
  {
    id: 'sql_injection.union_select',
    category: 'SQL_INJECTION',
    severity: 'BLOCK',
    pattern: /\bunion\s+(?:all\s+)?select\b/i,
    description: 'UNION-based SQL exfiltration probe',
  },
  {
    id: 'sql_injection.drop_table',
    category: 'SQL_INJECTION',
    severity: 'BLOCK',
    pattern: /\bdrop\s+table\b/i,
    description: 'Destructive DDL probe (DROP TABLE)',
  },
  {
    id: 'sql_injection.boolean_or',
    category: 'SQL_INJECTION',
    severity: 'BLOCK',
    pattern: /['"`]\s*or\s*['"`]?\s*\d+\s*['"`]?\s*=\s*['"`]?\s*\d+/i,
    description: "Boolean-tautology bypass (' OR '1'='1)",
  },
  {
    id: 'sql_injection.stacked_query',
    category: 'SQL_INJECTION',
    severity: 'BLOCK',
    pattern: /;\s*(?:select|insert|update|delete|drop|alter|truncate)\b/i,
    description: 'Stacked-query probe (;SELECT … / ;DROP …)',
  },
  {
    id: 'sql_injection.comment_marker',
    category: 'SQL_INJECTION',
    severity: 'LOG',
    pattern: /(?:--\s|#\s|\/\*[\s\S]*?\*\/)/,
    description: 'Trailing SQL comment marker (often used to truncate)',
  },

  // ------------------------------------------------------------------
  // XSS
  // ------------------------------------------------------------------
  {
    id: 'xss.script_tag',
    category: 'XSS',
    severity: 'BLOCK',
    pattern: /<\s*script\b[^>]*>/i,
    description: '<script> tag injection',
  },
  {
    id: 'xss.javascript_protocol',
    category: 'XSS',
    severity: 'BLOCK',
    pattern: /javascript\s*:/i,
    description: 'javascript: pseudo-protocol',
  },
  {
    id: 'xss.event_handler',
    category: 'XSS',
    severity: 'BLOCK',
    pattern:
      /\bon(?:load|click|error|mouseover|focus|blur|submit|change|keydown|keyup|input|wheel)\s*=/i,
    description: 'Inline DOM event handler attribute',
  },
  {
    id: 'xss.iframe_dangerous_src',
    category: 'XSS',
    severity: 'BLOCK',
    pattern: /<\s*iframe\b[^>]*src\s*=\s*['"]?(?:javascript:|data:)/i,
    description: 'iframe with dangerous src',
  },

  // ------------------------------------------------------------------
  // PATH TRAVERSAL
  // ------------------------------------------------------------------
  {
    id: 'path_traversal.dotdot',
    category: 'PATH_TRAVERSAL',
    severity: 'BLOCK',
    pattern: /\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\.\.%2f|%2e%2e%5c/i,
    description: 'Directory traversal (../) including encoded variants',
  },
  {
    id: 'path_traversal.sensitive_file',
    category: 'PATH_TRAVERSAL',
    severity: 'BLOCK',
    pattern: /\/etc\/(?:passwd|shadow|hosts)\b|\\windows\\system32\\/i,
    description: 'Direct probe for sensitive system file',
  },

  // ------------------------------------------------------------------
  // RCE / COMMAND INJECTION
  // ------------------------------------------------------------------
  {
    id: 'rce.shell_chain',
    category: 'RCE',
    severity: 'BLOCK',
    pattern: /[;|&]\s*(?:rm|cat|wget|curl|sh|bash|nc|netcat|chmod)\s/i,
    description: 'Shell chain (`; rm`, `| cat`, `& wget`, …)',
  },
  {
    id: 'rce.command_substitution',
    category: 'RCE',
    severity: 'BLOCK',
    // backtick-quoted command OR $( … ) substitution. The latter is
    // bounded to ~80 chars to avoid catastrophic backtracking.
    pattern: /`[^`]{1,80}`|\$\([^)]{1,80}\)/,
    description: 'Backtick or $(…) command substitution',
  },
  {
    id: 'rce.dangerous_eval',
    category: 'RCE',
    severity: 'BLOCK',
    pattern: /\b(?:eval|exec|system|passthru)\s*\(/i,
    description: 'Direct call to a dangerous evaluation primitive',
  },

  // ------------------------------------------------------------------
  // SUSPICIOUS
  // ------------------------------------------------------------------
  {
    id: 'suspicious.scanner_user_agent',
    category: 'SUSPICIOUS',
    severity: 'CHALLENGE',
    pattern: /\b(?:sqlmap|nikto|nmap|acunetix|w3af|burpsuite|curl\/[\d.]+\s+nmap)\b/i,
    description: 'Known security-scanner User-Agent',
  },
];

/**
 * Logical surface that produced the match — surfaced in the structured
 * log so a SOC analyst can pivot quickly.
 */
export type WafMatchSurface = 'url' | 'query' | 'body' | 'headers';

/**
 * Outcome of evaluating a request against the rule registry. Always
 * returned synchronously; the middleware is responsible for shaping
 * the actual HTTP response.
 */
export interface WafEvaluation {
  /** Rule that matched the highest-severity action, or `null` when clean. */
  matched: WafRule | null;
  /** Logical surface of the match. `null` when nothing fired. */
  surface: WafMatchSurface | null;
  /** Detections at LOG / CHALLENGE severities — used for SIEM log enrichment. */
  detections: ReadonlyArray<{
    rule: WafRule;
    surface: WafMatchSurface;
  }>;
}
