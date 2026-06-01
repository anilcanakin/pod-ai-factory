-- CreateEnum
CREATE TYPE "PersonalizationStatus" AS ENUM ('PENDING', 'COMPOSITING', 'COMPOSITED', 'APPROVED', 'REJECTED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "PhotoTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "occasion" TEXT NOT NULL,
    "baseArtworkUrl" TEXT NOT NULL,
    "photoSlot" JSONB NOT NULL,
    "textLayers" JSONB NOT NULL,
    "printWidthPx" INTEGER NOT NULL,
    "printHeightPx" INTEGER NOT NULL,
    "mockupConfig" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalizationOrder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "etsyOrderRef" TEXT,
    "templateId" TEXT NOT NULL,
    "customerPhotoUrl" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "status" "PersonalizationStatus" NOT NULL DEFAULT 'PENDING',
    "printFileUrl" TEXT,
    "mockupUrl" TEXT,
    "warnings" JSONB,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalizationOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoTemplate_workspaceId_occasion_idx" ON "PhotoTemplate"("workspaceId", "occasion");

-- CreateIndex
CREATE INDEX "PersonalizationOrder_workspaceId_status_idx" ON "PersonalizationOrder"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "PhotoTemplate" ADD CONSTRAINT "PhotoTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationOrder" ADD CONSTRAINT "PersonalizationOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationOrder" ADD CONSTRAINT "PersonalizationOrder_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PhotoTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
