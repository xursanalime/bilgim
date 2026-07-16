-- AlterTable
ALTER TABLE "TeacherProfile" ADD COLUMN     "examTrackFocus" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "taughtCefrLevels" "CefrLevel"[] DEFAULT ARRAY[]::"CefrLevel"[];
