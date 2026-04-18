-- CreateTable: DailyTask (AI Agent günlük hedef takibi)
-- IF NOT EXISTS → tablo önceden oluşturulmuşsa sessizce geç
CREATE TABLE IF NOT EXISTS "DailyTask" (
    "id"           TEXT        NOT NULL,
    "date"         TIMESTAMP(3) NOT NULL,
    "taskType"     TEXT        NOT NULL,
    "targetCount"  INTEGER     NOT NULL DEFAULT 10,
    "currentCount" INTEGER     NOT NULL DEFAULT 0,
    "isCompleted"  BOOLEAN     NOT NULL DEFAULT false,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3),

    CONSTRAINT "DailyTask_pkey" PRIMARY KEY ("id")
);

-- Eğer updatedAt kolonu henüz yoksa ekle (tablo mevcut durumda eksik kolona sahip olabilir)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'DailyTask' AND column_name = 'updatedAt'
    ) THEN
        ALTER TABLE "DailyTask" ADD COLUMN "updatedAt" TIMESTAMP(3);
    END IF;
END $$;

-- CreateIndex: date + taskType bileşik benzersiz index
CREATE UNIQUE INDEX IF NOT EXISTS "DailyTask_date_taskType_key"
    ON "DailyTask"("date", "taskType");
