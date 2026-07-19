-- Task 22.2 — Push notification device registry.
--
-- Adds `PushDevice` so the mobile app can register an Expo push token
-- against a `User` row, and the existing `PushProcessor` can look up the
-- right `(token, platform)` pair when delivering a notification on the
-- PUSH channel (Req 16.1, Req 16.5).
--
-- Schema rules:
--   * One row per `(userId, token)` — the mobile app may re-register
--     the same token on every cold boot; the unique index turns the
--     re-register into a `lastSeenAt` bump.
--   * `revokedAt` flips to NOW() when Expo returns `DeviceNotRegistered`
--     so the worker never tries to deliver to a dead token.
--   * `deviceInfo` stores `expo-device` metadata (modelName, osName,
--     osVersion, appVersion, locale) so support engineers can debug
--     push failures without joining additional tables.

-- CreateTable
CREATE TABLE "PushDevice" (
    "id"         UUID NOT NULL,
    "userId"     UUID NOT NULL,
    "token"      TEXT NOT NULL,
    "platform"   TEXT NOT NULL,
    "deviceInfo" JSONB,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"  TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushDevice_userId_token_key" ON "PushDevice"("userId", "token");
CREATE INDEX "PushDevice_userId_revokedAt_idx" ON "PushDevice"("userId", "revokedAt");

ALTER TABLE "PushDevice"
  ADD CONSTRAINT "PushDevice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
