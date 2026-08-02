-- Task 28.2 — Key Management & rotation.
--
-- `EncryptionKey` stores wrapped (envelope-encrypted) data keys (DEKs).
-- Plaintext key material never lives in the database; the wrapping is
-- performed by `EncryptionService` against the master key supplied via
-- `MASTER_ENCRYPTION_KEY` / `MASTER_KEY`.
--
-- Lifecycle:
--   * exactly one row is `ACTIVE` at a time,
--   * the previous `ACTIVE` row flips to `RETIRED` on rotation and
--     `rotatedToId` forward-points to the new key,
--   * retired rows remain readable until `ReencryptProcessor`
--     migrates every envelope off them, after which an operator
--     can prune the row (crypto-shredding, Req 28.7).

-- CreateEnum
CREATE TYPE "EncryptionKeyStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "EncryptionKey" (
    "id" TEXT NOT NULL,
    "keyMaterial" TEXT NOT NULL,
    "status" "EncryptionKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "rotatedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "EncryptionKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EncryptionKey_status_idx" ON "EncryptionKey"("status");

-- CreateIndex
CREATE INDEX "EncryptionKey_createdAt_idx" ON "EncryptionKey"("createdAt");
