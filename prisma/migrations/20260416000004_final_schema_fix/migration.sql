-- Add flagReason to Image (column already exists in DB — IF NOT EXISTS prevents error)
ALTER TABLE "Image" ADD COLUMN IF NOT EXISTS "flagReason" TEXT;

-- Create ApiUsage table (does not exist in DB yet)
CREATE TABLE IF NOT EXISTS "ApiUsage" (
    "id"           TEXT            NOT NULL,
    "workspaceId"  TEXT,
    "provider"     TEXT            NOT NULL,
    "modelName"    TEXT,
    "inputTokens"  INTEGER         NOT NULL DEFAULT 0,
    "outputTokens" INTEGER         NOT NULL DEFAULT 0,
    "cost"         DECIMAL(12, 6)  NOT NULL DEFAULT 0.000000,
    "metadata"     JSONB,
    "createdAt"    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("id")
);
