-- AlterTable: track when a message was last edited (null = never edited)
ALTER TABLE "ChatMessage" ADD COLUMN "editedAt" TIMESTAMP(3);
