-- Task 28.3 — PII masking & crypto-shredding.
--
-- Adds the `SHREDDED` lifecycle state to `EncryptionKeyStatus` plus
-- per-user ownership columns on `EncryptionKey`. Together they let
-- `CryptoShredService` lazily mint a per-user data-encryption key
-- on first use, then permanently destroy it (`status='SHREDDED'`,
-- `keyMaterial=''`, `shreddedAt=NOW()`) when the user requests data
-- erasure under GDPR Article 17 (Req 28.7).
--
-- Rationale for storing a tombstone row instead of a hard DELETE:
--   * Audit posture — operators need a reliable trail showing the
--     key existed and was destroyed at a specific time.
--   * Foreign-key safety — encrypted column ciphertexts may still
--     embed the key id; the row stays for forensic purposes but
--     `keyMaterial=''` makes the underlying data permanently
--     unrecoverable.
--   * Idempotent shred — re-shredding a user is a no-op against a
--     tombstoned row; the service short-circuits without creating
--     a fresh key.
--
-- Why a partial unique index instead of column-level uniqueness:
--   * The platform-wide DEK rotated by `KeyManagementService`
--     leaves `userId = NULL`. We only require uniqueness for ACTIVE
--     per-user keys so a user can't accidentally end up with two
--     live keys at once.

-- AlterEnum
ALTER TYPE "EncryptionKeyStatus" ADD VALUE 'SHREDDED';

-- AlterTable
ALTER TABLE "EncryptionKey" ADD COLUMN "userId" UUID;
ALTER TABLE "EncryptionKey" ADD COLUMN "shreddedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "EncryptionKey_userId_idx" ON "EncryptionKey"("userId");

-- Partial unique index — at most one ACTIVE per-user key at a time.
-- Platform-wide rows (userId IS NULL) are excluded so the existing
-- single-active-DEK invariant from Task 28.2 keeps working.
CREATE UNIQUE INDEX "EncryptionKey_userId_active_unique"
  ON "EncryptionKey"("userId")
  WHERE "status" = 'ACTIVE' AND "userId" IS NOT NULL;
