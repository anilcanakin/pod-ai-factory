-- DailyTask tablosuna eksik timestamp kolonlarını ekle (varsa atla)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'DailyTask' AND column_name = 'createdAt'
    ) THEN
        ALTER TABLE "DailyTask" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'DailyTask' AND column_name = 'updatedAt'
    ) THEN
        ALTER TABLE "DailyTask" ADD COLUMN "updatedAt" TIMESTAMP(3);
    END IF;
END $$;
