/**
 * `modules/security/encryption/encryption.service.ts` — Task 28.1
 * canonical entry point.
 *
 * Why this file exists when the implementation lives in
 * `common/crypto/encryption.service.ts`:
 *
 *   - The Phase 9 Billing rollout (Task 24.1) put the AES-256-GCM
 *     primitive under `common/crypto` because it was needed by both
 *     auth and billing before the SecurityModule was carved out.
 *   - Task 28.1 explicitly calls for a SecurityModule-scoped path
 *     (`modules/security/encryption/encryption.service.ts`) so future
 *     security work (key rotation, PII masking, crypto-shredding —
 *     Tasks 28.2 / 28.3) can be co-located with the encryption
 *     primitive without leaking back into the common layer.
 *
 * Rather than duplicate the 280-line battle-tested implementation,
 * this module re-exports the same `EncryptionService`,
 * `EncryptionKeyManager`, and `EncryptionError` symbols from the
 * common package. Both import paths resolve to the same DI provider
 * (singleton `EncryptionService` from the global `CryptoModule`), so
 * call sites can pick whichever path matches their bounded context.
 *
 * Wire format, AAD semantics, and error codes are documented in the
 * source file at `common/crypto/encryption.service.ts`.
 *
 * Requirements: 28.1, 28.3.
 */
export {
  EncryptionService,
  ENCRYPTION_KEY_MANAGER_TOKEN,
  CURRENT_ENVELOPE_VERSION,
} from '../../../common/crypto/encryption.service';

export {
  EncryptionKeyManager,
  ACTIVE_KEY_VERSION,
  decodeMasterKey,
} from '../../../common/crypto/encryption-key-manager';

export {
  EncryptionError,
  type EncryptionErrorCode,
} from '../../../common/crypto/encryption.errors';
