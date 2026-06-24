-- AlterTable: configurable countdown length for the shared event timer (default 20 min)
ALTER TABLE "Event" ADD COLUMN "timerDurationSeconds" INTEGER NOT NULL DEFAULT 1200;
