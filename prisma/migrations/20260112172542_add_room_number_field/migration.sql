-- AlterEnum
ALTER TYPE "CaseState" ADD VALUE 'room_number_entered';

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "roomNumber" TEXT;
