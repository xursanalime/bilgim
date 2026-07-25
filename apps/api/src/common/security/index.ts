/**
 * `common/security` — barrel for cross-cutting security primitives
 * shared across the API. Per-area subfolders own the heavy lifting;
 * this index exposes a stable import path so call sites don't have
 * to know the internal directory layout.
 */

// Threat protection middleware + the services it composes (Task 27.1).
// Re-exported from this barrel so `main.ts` can pull the full surface
// from a single import.
export {
  detectSuspiciousRequest,
  SUSPICIOUS_RULES,
  SUSPICIOUS_HEADER_LIMIT_BYTES,
  TieredRateLimiterService,
  TIERED_RATE_LIMITS,
  GeoBlockerService,
  ThreatProtectionMiddleware,
  PrismaThreatAuditLogger,
  makeThreatProtectionRequestHandler,
  type SuspiciousCategory,
  type SuspiciousSurface,
  type SuspiciousRule,
  type SuspiciousRequestMatch,
  type InspectableRequest,
  type RateLimitCaller,
  type RateLimitResult,
  type RateLimitReason,
  type GeoLookupRequest,
  type GeoDecision,
  type ThreatRequest,
  type ThreatResponse,
  type ThreatNext,
  type ThreatAuditLogger,
  type ThreatAuditEvent,
} from './threat-protection';

// Field-level AES-256-GCM encryption (Task 28.1).
export {
  EncryptionService,
  CURRENT_ENVELOPE_VERSION,
  DEFAULT_KEY_ID,
  decodeMasterKeyHex,
  FieldEncryptionError,
  type EncryptedBlob,
  type FieldEncryptionErrorCode,
} from './encryption';

// Documentation-only nominal type used to flag columns / fields that
// hold ciphertext at rest (Task 28.1). The brand is a TypeScript
// trick — at runtime the value is a plain string. Kept in a sibling
// `types.ts` so it's importable without dragging in either of the
// `EncryptionService` implementations under `common/security`.
export type { EncryptedField } from './types';
export {
  CLIENT_IP_HEADER,
  PROXY_TOKEN_HEADER,
  applyTrustedClientIp,
  isIpLiteral,
  makeTrustedClientIpHandler,
} from './trusted-client-ip.middleware';
