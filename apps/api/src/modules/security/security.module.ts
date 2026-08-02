import { Module, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../../infra/prisma';
import { CryptoModule } from '../../common/crypto';
import { EncryptionService as MasterEncryptionService } from '../../common/security/encryption/encryption.service';
import { AdminModule } from '../admin/admin.module';
import {
  ADMIN_NOTIFIER,
  BruteForceService,
} from './brute-force/brute-force.service';
import { HCaptchaService } from './brute-force/hcaptcha.service';
import { AdminNotificationAdapter } from './brute-force/admin-notification.adapter';
import { GeoIpService } from './geo/geoip.service';
import { ImpossibleTravelService } from './geo/impossible-travel.service';
import { SecurityWafMiddleware } from './waf/waf.middleware';
import { SecurityRateLimitGuard } from './waf/rate-limit.guard';
import { BehavioralService } from './bot-detection/behavioral.service';
import { BotDetectionController } from './bot-detection/bot-detection.controller';
import { BotDetectionGuard } from './bot-detection/bot-detection.guard';
import { BotDetectionService } from './bot-detection/bot-detection.service';
import { FingerprintService } from './bot-detection/fingerprint.service';
// Task 27.5 — SIEM, honeypot, IP blocklist, threat intel.
import { SiemService } from './siem/siem.service';
import { CorrelationEngine } from './siem/correlation.engine';
import { IpBlocklistService } from './blocklist/ip-blocklist.service';
import { IpBlocklistGuard } from './blocklist/ip-blocklist.guard';
import { IpBlocklistAdminController } from './blocklist/ip-blocklist-admin.controller';
import { HoneypotController } from './honeypot/honeypot.controller';
import { ThreatIntelService } from './threat-intel/threat-intel.service';
import { TlsEnforcementMiddleware } from './tls';
import { BackupEncryptionService } from './backup';
// Task 28.2 — Key management & 90-day rotation + re-encryption.
import {
  KeyManagementService,
  KMS_PROVIDER,
  KmsAdminController,
  KmsEnvelopeService,
  LocalKmsProvider,
  ReencryptProcessor,
  VaultKmsProvider,
  type KmsProvider,
} from './kms';
import {
  AuditTrailService,
  AuditTrailController,
  AuditDbAdapter,
  AUDIT_STORAGE,
} from './audit';

/**
 * SecurityModule — Phase 10 cross-cutting security services
 * (Tasks 27.1, 27.2, 27.3, …).
 *
 * Today this module owns:
 *   - **Task 28.1** — re-exposes the at-rest encryption surface
 *     (`EncryptionService`, `EncryptionKeyManager`,
 *     `createPrismaEncryptionExtension`) under the
 *     `modules/security/encryption/*` path. The implementation lives
 *     in the global `CryptoModule` (so Phase 9 Billing / Auth keep
 *     building); SecurityModule imports + re-exports it so future
 *     security work (Task 28.2 key rotation, 28.3 PII masking and
 *     crypto-shredding) lands inside this module without leaking
 *     back to the common layer.
 *   - **Task 27.1** — `SecurityWafMiddleware` (signature-based WAF)
 *     and `SecurityRateLimitGuard` (Redis token bucket per IP / user).
 *   - **Task 27.2** — `BruteForceService` (per-account NORMAL →
 *     TEMP_LOCKED → PERM_LOCKED state machine + per-IP credential
 *     stuffing detection, Req 27.4 / 27.5 / 27.9) and `HCaptchaService`
 *     (server-side hCaptcha verification used when the brute-force
 *     gate sets `captchaRequired`, Req 27.4).
 *   - **Task 27.3** — `GeoIpService` (MaxMind GeoLite2 + cf-ipcountry
 *     fallback) and `ImpossibleTravelService` (haversine-based
 *     anomaly detection, Req 27.3). Together they refuse logins when
 *     two consecutive password validations come from points >500km
 *     apart inside a 1h window and force MFA re-verification.
 *   - **Task 27.4** — `BotDetectionService` (per-request bot
 *     scorer), `FingerprintService` (device fingerprint cardinality
 *     tracker), `BehavioralService` (behavioural-summary collector),
 *     `BotDetectionGuard` + `@RequireBotCheck()` (opt-in route
 *     guard), and `BotDetectionController` (collector endpoints
 *     under `/security/behavior/report` + `/security/fingerprint/report`).
 *     Folds WAF, hCaptcha, fingerprint and behavioural signals into
 *     a single `{ score, signals, decision }` triple for high-risk
 *     handlers (login, register, payment) (Req 27.6).
 *
 * The task surfaces are intentionally additive — Task 27.1 wires
 * the middleware + guard at the request entry point (via `app.module`
 * `MiddlewareConsumer` and `APP_GUARD`), while Task 27.2 / 27.3
 * expose their services to the auth flow. Future Phase 10 tasks
 * (27.4 bot detection, 27.5 SIEM) can extend this same module.
 *
 * Imports:
 *   - `AdminModule` so the admin-notifier adapter (Task 27.2) can
 *     resolve `AdminAuditService` (writes the lockout / IP-block
 *     audit rows) and the operations panel can later surface the
 *     data. `AdminAuditService` is also reused by
 *     `ImpossibleTravelService` to write
 *     `security.impossible_travel.blocked` rows for the SIEM.
 *
 * `OutboxModule` is global (registered in `AppModule`) so
 * `OutboxService` is already on the DI graph; the notifier adapter
 * resolves it directly without needing to re-import.
 *
 * The module owns its own `PrismaClient` so the notifier adapter
 * can `findMany({ role: 'ADMIN' })` for in-app notification rows
 * without coupling to the auth module.
 */
@Module({
  imports: [ConfigModule, ScheduleModule.forRoot(), CryptoModule, forwardRef(() => AdminModule)],
  controllers: [BotDetectionController, HoneypotController, IpBlocklistAdminController, KmsAdminController, AuditTrailController],
  providers: [
    // Task 27.1 — WAF + rate limiting.
    SecurityWafMiddleware,
    SecurityRateLimitGuard,
    // Task 27.2 — brute-force + hCaptcha.
    BruteForceService,
    HCaptchaService,
    AdminNotificationAdapter,
    {
      provide: ADMIN_NOTIFIER,
      useExisting: AdminNotificationAdapter,
    },
    // Task 27.3 — impossible travel + GeoIP.
    GeoIpService,
    ImpossibleTravelService,
    // Task 27.4 — bot detection (service + guard + collectors).
    // The guard IS registered as an APP_GUARD so the
    // `@RequireBotCheck()` decorator on individual route handlers
    // (login, register, billing checkout, password reset, …) is
    // honoured without each controller needing its own
    // `@UseGuards(BotDetectionGuard)`. Routes without the decorator
    // pass straight through unchecked, so we still don't pay the
    // evaluation cost on hot read paths.
    BotDetectionService,
    BotDetectionGuard,
    {
      provide: APP_GUARD,
      useExisting: BotDetectionGuard,
    },
    BehavioralService,
    FingerprintService,
    // Task 27.5 — SIEM + honeypot + IP blocklist + threat intel.
    // SiemService is the central event ingestion point; the
    // CorrelationEngine consumes the same buffer and emits
    // synthetic follow-on events. IpBlocklistService is the
    // single source of truth for "this IP is rejected at the
    // edge"; the global guard is wired in `app.module.ts` so it
    // runs BEFORE every other security guard. ThreatIntelService
    // periodically pulls the AbuseIPDB / Spamhaus DROP feeds and
    // bulk-imports them into the blocklist.
    SiemService,
    CorrelationEngine,
    IpBlocklistService,
    IpBlocklistGuard,
    ThreatIntelService,
    // Task 28.4 — TLS enforcement + backup encryption.
    // `TlsEnforcementMiddleware` rejects plaintext HTTP requests
    // when `TLS_ENFORCEMENT_ENABLED=true` (default in production).
    // `BackupEncryptionService` owns the AES-256-GCM stream cipher
    // used by the cron backup pipeline (`infra/security/backup/run-backup.sh`).
    // The backup key is intentionally separate (`BACKUP_ENCRYPTION_KEY`)
    // from the live data-encryption keys (Req 28.8).
    TlsEnforcementMiddleware,
    BackupEncryptionService,
    // Task 30.3 — Audit trail with cryptographic hash chaining.
    // `AuditTrailService` is the injectable entry point for other
    // modules to log sensitive operations. `AuditDbAdapter` is the
    // Prisma-based append-only storage backend.
    AuditTrailService,
    AuditDbAdapter,
    {
      provide: AUDIT_STORAGE,
      useExisting: AuditDbAdapter,
    },
    // Task 28.2 — Key management & 90-day rotation.
    // The master-key-backed `MasterEncryptionService` (from
    // `common/security/encryption/encryption.service.ts`) wraps
    // raw DEK material so the database never sees plaintext keys.
    // It's instantiated here (not registered globally) because it
    // intentionally has no dev fallback path through DI — the
    // boot guard inside its constructor reads `MASTER_KEY` and
    // refuses to start in production without a real value.
    MasterEncryptionService,
    // The provider is bound by `KMS_PROVIDER` env (default `local`).
    // `LocalKmsProvider` lives in the Prisma `EncryptionKey` table
    // and is suitable for dev / single-tenant deployments.
    // `VaultKmsProvider` talks to HashiCorp Vault Transit; falls
    // back to local when `VAULT_ADDR` is unset so misconfigured
    // deployments don't crash on boot.
    {
      provide: KMS_PROVIDER,
      inject: [PrismaClient, MasterEncryptionService, ConfigService],
      useFactory: (
        prisma: PrismaClient,
        masterEncryption: MasterEncryptionService,
        config: ConfigService,
      ): KmsProvider => {
        const provider =
          config.get<string>('KMS_PROVIDER') ??
          process.env.KMS_PROVIDER ??
          'local';
        if (provider === 'vault') {
          const addr =
            config.get<string>('VAULT_ADDR') ?? process.env.VAULT_ADDR ?? '';
          const token =
            config.get<string>('VAULT_TOKEN') ?? process.env.VAULT_TOKEN ?? '';
          const keyName =
            config.get<string>('VAULT_TRANSIT_KEY') ??
            process.env.VAULT_TRANSIT_KEY ??
            '';
          const mountPath =
            config.get<string>('VAULT_TRANSIT_MOUNT') ??
            process.env.VAULT_TRANSIT_MOUNT ??
            'transit';
          if (addr && token && keyName) {
            return new VaultKmsProvider({
              addr,
              token,
              keyName,
              mountPath,
            });
          }
          // Misconfigured Vault setup — fall back to local so dev
          // environments don't crash. A WARN line is logged by
          // `KeyManagementService.onModuleInit`.
        }
        return new LocalKmsProvider(prisma, masterEncryption);
      },
    },
    KeyManagementService,
    KmsEnvelopeService,
    ReencryptProcessor,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [
    SecurityWafMiddleware,
    SecurityRateLimitGuard,
    BruteForceService,
    HCaptchaService,
    GeoIpService,
    ImpossibleTravelService,
    BotDetectionService,
    BotDetectionGuard,
    BehavioralService,
    FingerprintService,
    // Task 27.5 — exported for cross-module callers (auth flow,
    // brute-force adapter, admin tooling).
    SiemService,
    CorrelationEngine,
    IpBlocklistService,
    IpBlocklistGuard,
    ThreatIntelService,
    // Task 28.4 — exported so AppModule can wire the middleware in
    // `configure()` and CLI / cron callers can inject the service.
    TlsEnforcementMiddleware,
    BackupEncryptionService,
    // Task 30.3 — audit trail exported for cross-module callers
    // (auth flow, admin tooling, billing, enrollment).
    AuditTrailService,
    // Task 28.2 — key management exported for cross-module callers
    // (admin tooling, future column-encryption migrations).
    KeyManagementService,
    KmsEnvelopeService,
    ReencryptProcessor,
    KMS_PROVIDER,
  ],
})
export class SecurityModule {}
