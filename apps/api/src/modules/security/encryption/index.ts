/**
 * `modules/security/encryption` — public entry point for the
 * SecurityModule-scoped encryption surface (Task 28.1).
 *
 * Re-exports the AES-256-GCM `EncryptionService`, the key manager,
 * the typed error class, and the Prisma column-encryption extension.
 * Implementation lives under `common/crypto/*` and is shared with
 * Phase 9 callers (Auth, Billing) — both import paths resolve to the
 * same global DI singleton.
 */
export {
  EncryptionService,
  EncryptionKeyManager,
  ENCRYPTION_KEY_MANAGER_TOKEN,
  CURRENT_ENVELOPE_VERSION,
  ACTIVE_KEY_VERSION,
  decodeMasterKey,
  EncryptionError,
  type EncryptionErrorCode,
} from './encryption.service';

export {
  createPrismaEncryptionExtension,
  createEncryptionAllOperationsHook,
  DEFAULT_ENCRYPTED_FIELDS,
  type EncryptedFieldMap,
  type EncryptedFieldSpec,
  type PrismaAllOperationsHook,
  type PrismaOperationArgs,
} from './prisma-encryption.extension';
