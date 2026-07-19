/**
 * `common/security/encryption` — application-layer field-level
 * AES-256-GCM encryption service (Task 28.1).
 *
 * This is the spec-aligned service consumed by application code that
 * needs to wrap individual fields (PII columns, secrets stored at
 * rest, MFA shared secrets). It is intentionally separate from the
 * older `common/crypto/` envelope used by the Prisma extension —
 * keeping the surfaces independent lets either side evolve without
 * breaking the other.
 */
export {
  EncryptionService,
  CURRENT_ENVELOPE_VERSION,
  DEFAULT_KEY_ID,
  decodeMasterKeyHex,
  type EncryptedBlob,
} from './encryption.service';
export {
  FieldEncryptionError,
  type FieldEncryptionErrorCode,
} from './encryption.errors';
