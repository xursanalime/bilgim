-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "currentCefrLevel" "CefrLevel";

-- CreateTable
CREATE TABLE "ProficiencyLevelHistory" (
    "id" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "fromLevel" "CefrLevel",
    "toLevel" "CefrLevel",
    "source" TEXT NOT NULL,
    "changedById" UUID,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProficiencyLevelHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProficiencyLevelHistory_learnerId_changedAt_idx" ON "ProficiencyLevelHistory"("learnerId", "changedAt");

-- AddForeignKey
ALTER TABLE "ProficiencyLevelHistory" ADD CONSTRAINT "ProficiencyLevelHistory_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "StudentProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
