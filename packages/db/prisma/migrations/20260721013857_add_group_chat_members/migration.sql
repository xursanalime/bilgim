-- CreateEnum
CREATE TYPE "GroupChatRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "avatarAssetId" UUID;

-- CreateTable
CREATE TABLE "GroupChatMember" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "GroupChatRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "GroupChatMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupChatMember_userId_idx" ON "GroupChatMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupChatMember_groupId_userId_key" ON "GroupChatMember"("groupId", "userId");

-- AddForeignKey
ALTER TABLE "GroupChatMember" ADD CONSTRAINT "GroupChatMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupChatMember" ADD CONSTRAINT "GroupChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
