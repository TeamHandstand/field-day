-- AlterTable: global shared event stopwatch
ALTER TABLE "Event" ADD COLUMN "timerRunning" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "timerStartedAt" TIMESTAMP(3);
