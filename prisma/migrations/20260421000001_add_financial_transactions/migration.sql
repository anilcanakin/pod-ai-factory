-- CreateTable
CREATE TABLE IF NOT EXISTS "FinancialTransaction" (
    "id"          TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "imageId"     TEXT,
    "jobId"       TEXT,
    "type"        TEXT NOT NULL,
    "amount"      DECIMAL(12,6) NOT NULL,
    "provider"    TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FinancialTransaction_workspaceId_createdAt_idx"
    ON "FinancialTransaction"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FinancialTransaction_workspaceId_type_idx"
    ON "FinancialTransaction"("workspaceId", "type");
