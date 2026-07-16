-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "downloadAllowed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "drmPackaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "providerAssetId" TEXT;

-- CreateTable
CREATE TABLE "PlaybackSession" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "lessonId" UUID,
    "viewerUserId" UUID NOT NULL,
    "enrollmentId" UUID,
    "viewerTag" TEXT NOT NULL,
    "drmKeySystem" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybackSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaybackSession_viewerTag_idx" ON "PlaybackSession"("viewerTag");

-- CreateIndex
CREATE INDEX "PlaybackSession_assetId_issuedAt_idx" ON "PlaybackSession"("assetId", "issuedAt");

-- CreateIndex
CREATE INDEX "PlaybackSession_viewerUserId_issuedAt_idx" ON "PlaybackSession"("viewerUserId", "issuedAt");

-- AddForeignKey
ALTER TABLE "PlaybackSession" ADD CONSTRAINT "PlaybackSession_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
