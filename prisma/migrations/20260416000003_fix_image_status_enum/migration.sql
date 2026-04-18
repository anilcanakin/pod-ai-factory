-- Add missing ImageStatus enum values (IF NOT EXISTS prevents duplicate-value errors)
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in PostgreSQL.
ALTER TYPE "ImageStatus" ADD VALUE IF NOT EXISTS 'FLAGGED';
ALTER TYPE "ImageStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
