-- CreateEnum
CREATE TYPE "CefrLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "cefrLevel" "CefrLevel",
ADD COLUMN     "examTrack" TEXT;

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "cefrLevel" "CefrLevel";
