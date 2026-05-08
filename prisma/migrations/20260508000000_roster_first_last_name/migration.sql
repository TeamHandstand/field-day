-- Drop legacy single-name column on RosterUser and replace with firstName/lastName.
-- No legacy data to migrate (per product decision).
ALTER TABLE "RosterUser" DROP COLUMN "name";
ALTER TABLE "RosterUser" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RosterUser" ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RosterUser" ALTER COLUMN "firstName" DROP DEFAULT;
ALTER TABLE "RosterUser" ALTER COLUMN "lastName" DROP DEFAULT;
