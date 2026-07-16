/**
 * `modules/security/encryption/prisma-encryption.extension.ts` —
 * Task 28.1 SecurityModule-scoped re-export of the Prisma client
 * extension that auto-encrypts PII columns at write and decrypts on
 * read.
 *
 * The implementation lives at
 * `common/crypto/prisma-encryption.extension.ts` (see that file for
 * the full design rationale, write-path mutation strategy, and
 * rollout-safe read behaviour).
 *
 * Default field map (Req 28.3):
 *   - `User.phone`                     (string)
 *   - `User.address`                   (string)
 *   - `PaymeTransaction.account`       (json)
 *   - `PaymeTransaction.cardLastFour`  (string)
 *
 * Fields whose underlying columns haven't shipped yet are still
 * registered — the extension skips them at runtime, so adding the
 * column later requires zero code churn.
 */
export {
  createPrismaEncryptionExtension,
  createEncryptionAllOperationsHook,
  DEFAULT_ENCRYPTED_FIELDS,
  type EncryptedFieldMap,
  type EncryptedFieldSpec,
  type PrismaAllOperationsHook,
  type PrismaOperationArgs,
} from '../../../common/crypto/prisma-encryption.extension';
