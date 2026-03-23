/*
  Warnings:

  - You are about to drop the column `basePath` on the `MockupTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `blendMode` on the `MockupTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `maskPath` on the `MockupTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `opacity` on the `MockupTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `printAreaJson` on the `MockupTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `rotation` on the `MockupTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `shadowPath` on the `MockupTemplate` table. All the data in the column will be lost.
  - Added the required column `baseImagePath` to the `MockupTemplate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `configJson` to the `MockupTemplate` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MockupTemplate" DROP COLUMN "basePath",
DROP COLUMN "blendMode",
DROP COLUMN "maskPath",
DROP COLUMN "opacity",
DROP COLUMN "printAreaJson",
DROP COLUMN "rotation",
DROP COLUMN "shadowPath",
ADD COLUMN     "baseImagePath" TEXT NOT NULL,
ADD COLUMN     "configJson" JSONB NOT NULL,
ADD COLUMN     "maskImagePath" TEXT,
ADD COLUMN     "shadowImagePath" TEXT;
