-- CreateEnum
CREATE TYPE "TeacherAccentColor" AS ENUM ('BLUE', 'GREEN', 'PURPLE', 'ORANGE');

-- AlterTable
ALTER TABLE "TeacherProfile"
  ADD COLUMN "schoolName" TEXT,
  ADD COLUMN "accentColor" "TeacherAccentColor" NOT NULL DEFAULT 'BLUE';
