-- CreateEnum
CREATE TYPE "AggregationRule" AS ENUM ('single', 'sum_of_ranks');

-- CreateEnum
CREATE TYPE "InputRule" AS ENUM ('single_value', 'sum_of_pct_deviation', 'abs_deviation_from_target');

-- CreateEnum
CREATE TYPE "SortDirection" AS ENUM ('asc', 'desc');

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hashedPassword" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "finalizedSnapshot" JSONB,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "teamNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "cohortNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamPhoto" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "cloudinaryUrl" TEXT NOT NULL,
    "cloudinaryPublicId" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterUser" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "RosterUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "aggregationRule" "AggregationRule" NOT NULL,
    "isSystemSeeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubActivityTemplate" (
    "id" TEXT NOT NULL,
    "activityTemplateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "inputRule" "InputRule" NOT NULL,
    "sortDirection" "SortDirection" NOT NULL,

    CONSTRAINT "SubActivityTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InputFieldTemplate" (
    "id" TEXT NOT NULL,
    "subActivityTemplateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "defaultTargetValue" DOUBLE PRECISION,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InputFieldTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "aggregationRule" "AggregationRule" NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubActivity" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "inputRule" "InputRule" NOT NULL,
    "sortDirection" "SortDirection" NOT NULL,

    CONSTRAINT "SubActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InputField" (
    "id" TEXT NOT NULL,
    "subActivityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InputField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreEntry" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "subActivityId" TEXT NOT NULL,
    "computedValue" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByAdminId" TEXT,

    CONSTRAINT "ScoreEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreInput" (
    "id" TEXT NOT NULL,
    "scoreEntryId" TEXT NOT NULL,
    "inputFieldId" TEXT NOT NULL,
    "rawValue" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ScoreInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreEditLog" (
    "id" TEXT NOT NULL,
    "scoreEntryId" TEXT NOT NULL,
    "adminId" TEXT,
    "action" TEXT NOT NULL,
    "fieldChanged" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreEditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE INDEX "Team_eventId_idx" ON "Team"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_eventId_teamNumber_key" ON "Team"("eventId", "teamNumber");

-- CreateIndex
CREATE INDEX "TeamPhoto_teamId_idx" ON "TeamPhoto"("teamId");

-- CreateIndex
CREATE INDEX "RosterUser_teamId_idx" ON "RosterUser"("teamId");

-- CreateIndex
CREATE INDEX "SubActivityTemplate_activityTemplateId_idx" ON "SubActivityTemplate"("activityTemplateId");

-- CreateIndex
CREATE INDEX "InputFieldTemplate_subActivityTemplateId_idx" ON "InputFieldTemplate"("subActivityTemplateId");

-- CreateIndex
CREATE INDEX "Activity_eventId_idx" ON "Activity"("eventId");

-- CreateIndex
CREATE INDEX "SubActivity_activityId_idx" ON "SubActivity"("activityId");

-- CreateIndex
CREATE INDEX "InputField_subActivityId_idx" ON "InputField"("subActivityId");

-- CreateIndex
CREATE INDEX "ScoreEntry_subActivityId_idx" ON "ScoreEntry"("subActivityId");

-- CreateIndex
CREATE INDEX "ScoreEntry_teamId_idx" ON "ScoreEntry"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreEntry_teamId_subActivityId_key" ON "ScoreEntry"("teamId", "subActivityId");

-- CreateIndex
CREATE INDEX "ScoreInput_scoreEntryId_idx" ON "ScoreInput"("scoreEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreInput_scoreEntryId_inputFieldId_key" ON "ScoreInput"("scoreEntryId", "inputFieldId");

-- CreateIndex
CREATE INDEX "ScoreEditLog_scoreEntryId_idx" ON "ScoreEditLog"("scoreEntryId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamPhoto" ADD CONSTRAINT "TeamPhoto_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterUser" ADD CONSTRAINT "RosterUser_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubActivityTemplate" ADD CONSTRAINT "SubActivityTemplate_activityTemplateId_fkey" FOREIGN KEY ("activityTemplateId") REFERENCES "ActivityTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InputFieldTemplate" ADD CONSTRAINT "InputFieldTemplate_subActivityTemplateId_fkey" FOREIGN KEY ("subActivityTemplateId") REFERENCES "SubActivityTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ActivityTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubActivity" ADD CONSTRAINT "SubActivity_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InputField" ADD CONSTRAINT "InputField_subActivityId_fkey" FOREIGN KEY ("subActivityId") REFERENCES "SubActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_subActivityId_fkey" FOREIGN KEY ("subActivityId") REFERENCES "SubActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreInput" ADD CONSTRAINT "ScoreInput_scoreEntryId_fkey" FOREIGN KEY ("scoreEntryId") REFERENCES "ScoreEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreInput" ADD CONSTRAINT "ScoreInput_inputFieldId_fkey" FOREIGN KEY ("inputFieldId") REFERENCES "InputField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEditLog" ADD CONSTRAINT "ScoreEditLog_scoreEntryId_fkey" FOREIGN KEY ("scoreEntryId") REFERENCES "ScoreEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEditLog" ADD CONSTRAINT "ScoreEditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
