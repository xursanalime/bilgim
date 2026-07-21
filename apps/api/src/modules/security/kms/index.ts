/**
 * `modules/security/kms` — Task 28.2 (Key Management & rotation).
 *
 * Public surface:
 *   - `KmsProvider` interface + `KMS_PROVIDER` DI token.
 *   - `LocalKmsProvider` (Prisma-backed) and `VaultKmsProvider`
 *     (HashiCorp Vault Transit).
 *   - `KeyManagementService` — policy layer with 90-day cron and
 *     manual rotation; consumes the active provider via DI.
 *   - `KmsEnvelopeService` — v2 envelope encryption that embeds
 *     the KMS key id so historical rows decrypt under their
 *     original key after a rotation.
 *   - `ReencryptProcessor` — re-encryption sweep triggered after
 *     rotation; idempotent across `User.phone`, `User.address` and
 *     `PaymeTransaction.cardLastFour`.
 */
export type {
  KmsKey,
  KmsKeyStatus,
  KmsProvider,
} from './kms.port';
export { KMS_PROVIDER } from './kms.port';

export { LocalKmsProvider } from './local-kms.provider';
export {
  VaultKmsProvider,
  type VaultHttpFetcher,
  type VaultKmsConfig,
} from './vault-kms.provider';

export {
  KeyManagementService,
  KMS_ROTATION_HOOK,
  type KeyManagementConfig,
  type RotationHook,
} from './key-management.service';

export {
  KmsEnvelopeService,
  KMS_ENVELOPE_VERSION,
} from './kms-envelope.service';

export {
  ReencryptProcessor,
  DEFAULT_REENCRYPT_TARGETS,
  type ReencryptOptions,
  type ReencryptResult,
  type ReencryptTarget,
} from './reencrypt.processor';

export { KmsAdminController } from './kms-admin.controller';
