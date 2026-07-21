CREATE TABLE "AiConversation" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID         NOT NULL,
  "title"     TEXT         NOT NULL DEFAULT 'Yangi suhbat',
  "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "AiConversation_userId_updatedAt_idx" ON "AiConversation"("userId", "updatedAt" DESC);

CREATE TABLE "AiMessage" (
  "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
  "conversationId" UUID         NOT NULL,
  "role"           TEXT         NOT NULL,
  "content"        TEXT         NOT NULL,
  "attachments"    JSONB,
  "createdAt"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE
);
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- AiIntent additions
ALTER TYPE "AiIntent" ADD VALUE IF NOT EXISTS 'AI_CHAT';
ALTER TYPE "AiIntent" ADD VALUE IF NOT EXISTS 'GENERATE_TEST';
ALTER TYPE "AiIntent" ADD VALUE IF NOT EXISTS 'SUGGEST_RUBRIC';
ALTER TYPE "AiIntent" ADD VALUE IF NOT EXISTS 'TRANSLATE_WORD';
ALTER TYPE "AiIntent" ADD VALUE IF NOT EXISTS 'TRANSLATE_SENTENCE';

-- NotificationKind addition
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'GAMIFICATION_LEVEL_UP';
