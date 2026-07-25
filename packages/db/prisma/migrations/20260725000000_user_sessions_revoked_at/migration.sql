-- Access tokens are stateless JWTs. Revoking `Session` rows (logout,
-- password reset, admin suspend) previously left an already-issued access
-- token valid for the remainder of its TTL. `sessionsRevokedAt` is the
-- cut-off `SessionValidatorService` compares each token's `iat` against,
-- making those events revoke instantly and globally.
ALTER TABLE "User" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
