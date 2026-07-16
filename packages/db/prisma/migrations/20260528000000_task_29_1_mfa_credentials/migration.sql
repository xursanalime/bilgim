-- Task 29.1 — Multi-Factor Authentication.
--
-- Adds the schema needed by `MfaService` (TOTP + WebAuthn/FIDO2 + backup
-- codes) and the role-based MFA gate in `AuthService.login`:
--
--   * `MfaType` enum — TOTP / WEBAUTHN
--   * `User.mfaRequired` — pinned to TRUE for any ADMIN row (DB trigger
--     guarantees it stays true on insert/update of role) so the login flow
--     can refuse to issue tokens until an admin enrolls a factor.
--   * `MfaCredential` — one row per enrolled factor. `secret` holds the
--     encrypted TOTP shared secret OR the WebAuthn public key (COSE).
--     The raw key is NEVER persisted in plaintext — column-level encryption
--     happens in `MfaService` via the platform `EncryptionService` (Task 28.1)
--     or, when that service is not yet wired, an in-process AES-256-GCM
--     fallback keyed by `MFA_ENCRYPTION_KEY`.
--   * `credentialId` — WebAuthn credential id (base64url). Unique so the
--     same hardware key cannot be enrolled twice.
--   * `counter` — WebAuthn signature counter for anti-clone replay.
--   * `deviceInfo` — JSON metadata (AAGUID, transports, app fingerprint).
--   * `MfaBackupCode` — single-use SHA-256 hashed recovery codes, issued
--     in batches of 10. Optional `expiresAt` (default 1 year) lets us
--     prune stale codes.

-- CreateEnum
CREATE TYPE "MfaType" AS ENUM ('TOTP', 'WEBAUTHN');

-- AlterTable: pin mfaRequired flag onto User
ALTER TABLE "User" ADD COLUMN "mfaRequired" BOOLEAN NOT NULL DEFAULT false;

-- Trigger: ADMIN rows always get mfaRequired = true. Enforced at DB level
-- so a service bug or direct SQL update cannot silently relax the policy.
CREATE OR REPLACE FUNCTION enforce_admin_mfa_required()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."role" = 'ADMIN' THEN
    NEW."mfaRequired" := TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_admin_mfa_required
BEFORE INSERT OR UPDATE OF "role" ON "User"
FOR EACH ROW
EXECUTE FUNCTION enforce_admin_mfa_required();

-- Backfill existing admins.
UPDATE "User" SET "mfaRequired" = TRUE WHERE "role" = 'ADMIN';

-- CreateTable: MfaCredential
CREATE TABLE "MfaCredential" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "MfaType" NOT NULL,
    "label" TEXT,
    "secret" TEXT NOT NULL,
    "counter" BIGINT,
    "credentialId" TEXT,
    "deviceInfo" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MfaCredential_credentialId_key" ON "MfaCredential"("credentialId");
CREATE INDEX "MfaCredential_userId_type_idx" ON "MfaCredential"("userId", "type");

ALTER TABLE "MfaCredential"
  ADD CONSTRAINT "MfaCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: MfaBackupCode
CREATE TABLE "MfaBackupCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "MfaBackupCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MfaBackupCode_userId_codeHash_key" ON "MfaBackupCode"("userId", "codeHash");
CREATE INDEX "MfaBackupCode_userId_usedAt_idx" ON "MfaBackupCode"("userId", "usedAt");

ALTER TABLE "MfaBackupCode"
  ADD CONSTRAINT "MfaBackupCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
