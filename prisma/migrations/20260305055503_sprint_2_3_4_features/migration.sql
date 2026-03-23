-- AlterTable
ALTER TABLE "DesignJob" ADD COLUMN     "keyword" TEXT,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN     "niche" TEXT,
ADD COLUMN     "packId" TEXT,
ADD COLUMN     "style" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "monthlyUsage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "planLimit" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "planName" TEXT NOT NULL DEFAULT 'starter',
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "usageResetDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ProductPack" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPackItem" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "placementConfig" JSONB NOT NULL,
    "templateUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPackItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DesignJob" ADD CONSTRAINT "DesignJob_packId_fkey" FOREIGN KEY ("packId") REFERENCES "ProductPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPack" ADD CONSTRAINT "ProductPack_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPackItem" ADD CONSTRAINT "ProductPackItem_packId_fkey" FOREIGN KEY ("packId") REFERENCES "ProductPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
