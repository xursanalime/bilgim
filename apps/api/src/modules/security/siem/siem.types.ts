/**
 * Shared SIEM types (Task 27.5, Req 27.7).
 *
 * The SIEM pipeline ingests every security-relevant event in the
 * platform — auth failures, WAF hits, brute-force trips, honeypot
 * touches, correlation matches — into a single structured stream.
 * Loki picks the events up via the JSON log line tagged
 * `event=security.<type>`; Sentry receives the HIGH/CRITICAL subset
 * for paging.
 */

/** Severity ladder consumed by the alerting rules. */
export type SiemSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Canonical event type vocabulary. Strings are namespaced so the
 * Loki/Grafana dashboards can group related families together
 * (`security.auth.*`, `security.waf.*`, `security.honeypot.*`,
 * `security.correlation.*`).
 */
export type SiemEventType =
  // Auth surface
  | 'security.auth.login.failed'
  | 'security.auth.login.success'
  | 'security.auth.account.locked'
  | 'security.auth.account.unlocked'
  | 'security.auth.password.reset_requested'
  | 'security.auth.password.changed'
  | 'security.auth.session.ip_changed'
  // WAF / bot / threat
  | 'security.waf.block'
  | 'security.waf.detected'
  | 'security.bot.detected'
  | 'security.rate_limit.exceeded'
  | 'security.geo.blocked'
  | 'security.impossible_travel'
  // Brute-force / credential stuffing
  | 'security.brute_force.temp_locked'
  | 'security.brute_force.perm_locked'
  | 'security.brute_force.ip_blocked'
  // Honeypot
  | 'security.honeypot.hit'
  // IP blocklist
  | 'security.blocklist.ip.added'
  | 'security.blocklist.ip.removed'
  | 'security.blocklist.ip.rejected'
  // Threat intel
  | 'security.threat_intel.sync.started'
  | 'security.threat_intel.sync.succeeded'
  | 'security.threat_intel.sync.failed'
  // Correlation engine matches
  | 'security.correlation.credential_stuffing'
  | 'security.correlation.session_hijack_suspect'
  | 'security.correlation.coordinated_attack'
  | 'security.correlation.automated_scanner';

/** Caller-supplied event payload before the SIEM service stamps in metadata. */
export interface SiemEventInput {
  type: SiemEventType;
  severity: SiemSeverity;
  /** Authenticated user when the event happened. */
  userId?: string | null;
  /** Source IP — `unknown` is acceptable but should be rare. */
  ip: string;
  /** Cross-layer trace id (propagated from `X-Request-Id`). */
  traceId?: string | null;
  /** Free-form bag — keep small (< 4 KiB), no raw secrets. */
  payload?: Record<string, unknown>;
}

/** Persisted shape stored in Redis for the correlation engine. */
export interface SiemEventRecord {
  type: SiemEventType;
  severity: SiemSeverity;
  userId: string | null;
  ip: string;
  traceId: string | null;
  /** Epoch milliseconds the event was recorded. */
  occurredAt: number;
  payload: Record<string, unknown>;
}

/** Sliding window default for the correlation engine (15 min). */
export const SIEM_CORRELATION_WINDOW_SEC = 15 * 60;

/** Number of events retained per IP / per user in Redis. */
export const SIEM_RETENTION_LIMIT = 1000;
