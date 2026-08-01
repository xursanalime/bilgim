-- AlterTable: pin state — a room can have several pinned messages at once
ALTER TABLE "ChatMessage" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "ChatMessage" ADD COLUMN "pinnedById" UUID;

-- CreateIndex
CREATE INDEX "ChatMessage_roomId_pinnedAt_idx" ON "ChatMessage"("roomId", "pinnedAt");
