-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "adminName" TEXT;

-- Backfill adminName for existing rows that still have a live Admin
UPDATE "AuditLog" al
SET "adminName" = a."name"
FROM "Admin" a
WHERE al."adminId" = a."id" AND al."adminName" IS NULL;
