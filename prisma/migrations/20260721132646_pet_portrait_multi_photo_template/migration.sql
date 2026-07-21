-- AlterTable
ALTER TABLE "PersonalizationOrder" ADD COLUMN     "customerPhotoUrls" JSONB,
ADD COLUMN     "previewImageId" TEXT,
ALTER COLUMN "customerPhotoUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PhotoTemplate" ADD COLUMN     "photoSlots" JSONB,
ADD COLUMN     "templateType" TEXT NOT NULL DEFAULT 'frame',
ALTER COLUMN "baseArtworkUrl" DROP NOT NULL,
ALTER COLUMN "photoSlot" DROP NOT NULL;

