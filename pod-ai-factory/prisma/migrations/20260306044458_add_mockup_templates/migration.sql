-- CreateTable
CREATE TABLE "MockupTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "basePath" TEXT NOT NULL,
    "maskPath" TEXT,
    "shadowPath" TEXT,
    "printAreaJson" JSONB NOT NULL,
    "blendMode" TEXT NOT NULL DEFAULT 'normal',
    "opacity" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockupTemplate_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MockupTemplate" ADD CONSTRAINT "MockupTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
