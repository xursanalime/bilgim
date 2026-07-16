-- CreateTable
CREATE TABLE "PlacementAssessment" (
    "id" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "perSkillScores" JSONB,
    "computedLevel" "CefrLevel",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "PlacementAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementAnswer" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "skill" TEXT NOT NULL,
    "questionRef" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamTrack" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlacementAssessment_learnerId_startedAt_idx" ON "PlacementAssessment"("learnerId", "startedAt");

-- CreateIndex
CREATE INDEX "PlacementAnswer_assessmentId_idx" ON "PlacementAnswer"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementAnswer_assessmentId_questionRef_key" ON "PlacementAnswer"("assessmentId", "questionRef");

-- CreateIndex
CREATE UNIQUE INDEX "ExamTrack_slug_key" ON "ExamTrack"("slug");

-- AddForeignKey
ALTER TABLE "PlacementAssessment" ADD CONSTRAINT "PlacementAssessment_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "StudentProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementAnswer" ADD CONSTRAINT "PlacementAnswer_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "PlacementAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
