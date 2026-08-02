-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "assignmentId" UUID,
ALTER COLUMN "lessonId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Attachment_assignmentId_idx" ON "Attachment"("assignmentId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
