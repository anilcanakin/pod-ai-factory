-- AlterTable: Add market validation fields to Idea
ALTER TABLE "Idea" ADD COLUMN "marketScore" INTEGER;
ALTER TABLE "Idea" ADD COLUMN "marketData"  JSONB;
