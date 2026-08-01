-- AlterTable: per-room monotonic message counter (see ChatRoom.lastSeq doc comment)
ALTER TABLE "ChatRoom" ADD COLUMN "lastSeq" BIGINT NOT NULL DEFAULT 0;

-- AlterTable: add seq nullable first so existing rows can be backfilled
-- before the NOT NULL constraint is applied below.
ALTER TABLE "ChatMessage" ADD COLUMN "seq" BIGINT;

-- Backfill: assign each existing message a stable per-room sequence
-- number ordered by (createdAt, id) — id is included to deterministically
-- break ties between messages created in the same millisecond, which is
-- exactly the case this column exists to make orderable.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "roomId" ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "ChatMessage"
)
UPDATE "ChatMessage" cm
SET "seq" = ranked.rn
FROM ranked
WHERE cm."id" = ranked."id";

-- Backfill: each room's counter starts at its highest assigned seq (0 for
-- rooms with no messages yet) so the next live insert continues the
-- sequence instead of restarting it.
UPDATE "ChatRoom" cr
SET "lastSeq" = COALESCE(
  (SELECT MAX(cm."seq") FROM "ChatMessage" cm WHERE cm."roomId" = cr."id"),
  0
);

-- Now that every row has a value, enforce it going forward.
ALTER TABLE "ChatMessage" ALTER COLUMN "seq" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_roomId_seq_key" ON "ChatMessage"("roomId", "seq");

-- CreateIndex
CREATE INDEX "ChatMessage_roomId_seq_idx" ON "ChatMessage"("roomId", "seq");
