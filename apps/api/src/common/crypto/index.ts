/**
 * `common/crypto` — at-rest field-encryption primitives (Task 28.1).
 *
 * Public surface:
 *   - `EncryptionService` + `CryptoModule` — DI-ready service that
 *     encrypts/decrypts UTF-8 strings with AES-256-GCM and a
 *     versioned, dot-separated envelope format.
 *   - `EncryptionKeyManager` — owner of the active and historical
 *     master keys. Stub interface today (reads
 *     `MASTER_ENCRYPTION_KEY`); Task 28.2 plugs Vault / KMS in
 *     behind the same surface.
 *   - `EncryptionError` — typed error class with stable `code` field
 *     (`MASTER_KEY_MISSING`, `MASTER_KEY_INVALID`,
 *     `ENVELOPE_MALFORMED`, `UNSUPPORTED_VERSION`,
 *     `INVALID_AUTHENTICATION_TAG`).
 *   - `decodeMasterKey` — base64/hex decoder + length validator used
 *     by boot-time wiring.
 *   - `createPrismaEncryptionExtension` + `DEFAULT_ENCRYPTED_FIELDS`
 *     — Prisma `$extends` integration for auto-encrypting
 *     `User.phone` and `PaymeTransaction.account`.
 */
export {
  EncryptionService,
  ENCRYPTION_KEY_MANAGER_TOKEN,
  CURRENT_ENVELOPE_VERSION,
} from './encryption.service';
export {
  EncryptionKeyManager,
  ACTIVE_KEY_VERSION,
  decodeMasterKey,
} from './encryption-key-manager';
export {
  CryptoModule,
  EncryptionModule,
  encryptionKeyManagerFactory,
} from './crypto.module';
export {
  EncryptionError,
  type EncryptionErrorCode,
} from './encryption.errors';
export {
  createPrismaEncryptionExtension,
  createEncryptionAllOperationsHook,
  DEFAULT_ENCRYPTED_FIELDS,
  type EncryptedFieldMap,
  type EncryptedFieldSpec,
  type PrismaAllOperationsHook,
  type PrismaOperationArgs,
} from './prisma-encryption.extension';
