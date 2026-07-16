export { SecurityModule } from './security.module';

// Task 27.2 — brute-force + hCaptcha.
export {
  BruteForceService,
  ADMIN_NOTIFIER,
} from './brute-force/brute-force.service';
export type {
  AdminNotifier,
  BruteForceFailureResult,
  BruteForceAccountStatus,
  BruteForceIpStatus,
} from './brute-force/brute-force.service';
export { HCaptchaService } from './brute-force/hcaptcha.service';
export type { HCaptchaVerificationResult } from './brute-force/hcaptcha.service';
export { AdminNotificationAdapter } from './brute-force/admin-notification.adapter';

// Task 27.3 — impossible travel + GeoIP.
export {
  GeoIpService,
  ImpossibleTravelService,
  haversineDistanceKm,
  isPrivateIp,
  lookupFromHeader,
} from './geo';
export type {
  GeoIpLookup,
  ImpossibleTravelDecision,
} from './geo';

// Task 27.1 — WAF + rate limiting.
export {
  SecurityWafMiddleware,
  SECURITY_WAF_RULES_TOKEN,
  SecurityRateLimitGuard,
  SECURITY_RATE_LIMIT_DEFAULTS,
  DEFAULT_WAF_RULES,
} from './waf';
export type {
  SecurityWafRequest,
  SecurityWafResponse,
  SecurityWafNext,
  WafRule,
  WafSeverity,
  WafCategory,
  WafEvaluation,
  WafMatchSurface,
  BucketResult,
  RateLimitTier,
} from './waf';

// Task 27.5 — SIEM + honeypot + IP blocklist + threat intel.
export { SiemService, SiemSecurityEvent } from './siem/siem.service';
export { CorrelationEngine } from './siem/correlation.engine';
export type {
  SiemSeverity,
  SiemEventType,
  SiemEventInput,
  SiemEventRecord,
} from './siem/siem.types';
export {
  SIEM_CORRELATION_WINDOW_SEC,
  SIEM_RETENTION_LIMIT,
} from './siem/siem.types';
export { IpBlocklistService } from './blocklist/ip-blocklist.service';
export type { IpBlockStatus } from './blocklist/ip-blocklist.service';
export { IpBlocklistGuard } from './blocklist/ip-blocklist.guard';
export { HoneypotController } from './honeypot/honeypot.controller';
export {
  ThreatIntelService,
} from './threat-intel/threat-intel.service';
export type {
  ThreatIntelConfig,
  ThreatIntelSyncResult,
  HttpFetcher,
} from './threat-intel/threat-intel.service';

// Task 27.4 — bot detection + behavioural analysis + fingerprinting.
export {
  BotDetectionService,
  BotDetectionGuard,
  BotDetectionController,
  BehavioralService,
  FingerprintService,
  RequireBotCheck,
  REQUIRE_BOT_CHECK_KEY,
  BehaviorReportSchema,
  FingerprintReportSchema,
} from './bot-detection';
export type {
  BotDetectionRequest,
  BotDecision,
  BotEvaluation,
  BehavioralSignals,
  StoredBehavioralSummary,
  DeviceFingerprintPayload,
  FingerprintAnomalyResult,
  BehaviorReportDto,
  FingerprintReportDto,
} from './bot-detection';

// Task 28.2 — Key Management Service (KMS) + 90-day rotation +
// re-encryption sweep.
export {
  KMS_PROVIDER,
  KMS_ROTATION_HOOK,
  KMS_ENVELOPE_VERSION,
  KeyManagementService,
  KmsAdminController,
  KmsEnvelopeService,
  LocalKmsProvider,
  ReencryptProcessor,
  VaultKmsProvider,
  DEFAULT_REENCRYPT_TARGETS,
} from './kms';
export type {
  KeyManagementConfig,
  KmsKey,
  KmsKeyStatus,
  KmsProvider,
  ReencryptOptions,
  ReencryptResult,
  ReencryptTarget,
  RotationHook,
  VaultHttpFetcher,
  VaultKmsConfig,
} from './kms';

// Task 28.4 — TLS enforcement + backup encryption.
export {
  TlsEnforcementMiddleware,
  type TlsEnforcementRequest,
  type TlsEnforcementResponse,
  type TlsEnforcementNext,
} from './tls';
export {
  BackupEncryptionService,
  BackupEncryptionError,
  BACKUP_FORMAT,
  type BackupEncryptionDeps,
} from './backup';

// Task 28.1 — at-rest encryption (AES-256-GCM envelope).
// The implementation lives in the global `CryptoModule` so Phase 9
// callers (Auth, Billing) keep working; the SecurityModule re-exports
// the surface under `modules/security/encryption/*` so future Task
// 28.2 / 28.3 work can be co-located with the encryption primitive.
export {
  EncryptionService,
  EncryptionKeyManager,
  ENCRYPTION_KEY_MANAGER_TOKEN,
  CURRENT_ENVELOPE_VERSION,
  ACTIVE_KEY_VERSION,
  decodeMasterKey,
  EncryptionError,
  createPrismaEncryptionExtension,
  createEncryptionAllOperationsHook,
  DEFAULT_ENCRYPTED_FIELDS,
} from './encryption';
export type {
  EncryptionErrorCode,
  EncryptedFieldMap,
  EncryptedFieldSpec,
  PrismaAllOperationsHook,
  PrismaOperationArgs,
} from './encryption';
