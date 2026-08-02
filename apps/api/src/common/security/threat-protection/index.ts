/**
 * Public surface of the application-side threat-protection helpers
 * (Task 27.1).
 *
 * Three pieces:
 *
 *   - `detectSuspiciousRequest` — pure, stateless detector that
 *     inspects a request for SQLi / XSS / path-traversal / oversized
 *     header signatures.
 *   - `TieredRateLimiterService` — Redis-backed sliding-window limiter
 *     applying per-IP burst, per-IP global, and per-user caps.
 *   - `GeoBlockerService` — country-level deny list driven by the
 *     `BLOCKED_COUNTRIES` env variable.
 *
 * The {@link ThreatProtectionMiddleware} composes all three and is the
 * default entry point for `main.ts`.
 */

export {
  detectSuspiciousRequest,
  SUSPICIOUS_RULES,
  SUSPICIOUS_HEADER_LIMIT_BYTES,
  type SuspiciousCategory,
  type SuspiciousSurface,
  type SuspiciousRule,
  type SuspiciousRequestMatch,
  type InspectableRequest,
} from './suspicious-request.detector';

export {
  TieredRateLimiterService,
  TIERED_RATE_LIMITS,
  type RateLimitCaller,
  type RateLimitResult,
  type RateLimitReason,
} from './tiered-rate-limiter.service';

export {
  GeoBlockerService,
  type GeoLookupRequest,
  type GeoDecision,
} from './geo-blocker.service';

export {
  ThreatProtectionMiddleware,
  PrismaThreatAuditLogger,
  makeThreatProtectionRequestHandler,
  type ThreatRequest,
  type ThreatResponse,
  type ThreatNext,
  type ThreatAuditLogger,
  type ThreatAuditEvent,
} from './threat-protection.middleware';
