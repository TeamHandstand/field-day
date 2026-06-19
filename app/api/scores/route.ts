import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { validateAndComputeSub, persistSubScore } from "@/lib/scoring-save";
import { publishEvent } from "@/lib/pubnub-server";
import { audit } from "@/lib/audit";

// Saves all sub-activity scores for one (team, activity) pair in a single call.
// Body: { teamId, activityId, subEntries: [{ subActivityId, raws: {inputFieldId: number} }] }
const schema = z.object({
  teamId: z.string(),
  activityId: z.string(),
  subEntries: z
    .array(
      z.object({
        subActivityId: z.string(),
        raws: z.record(z.string(), z.number()),
      }),
    )
    .min(1),
});

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid score", parsed.error.flatten());
  const { teamId, activityId, subEntries } = parsed.data;

  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { event: true } });
  if (!team) return notFound("Team not found");
  if (team.event.isLocked) return badRequest("Event is locked");

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      subActivities: { include: { inputFields: true } },
    },
  });
  if (!activity || activity.eventId !== team.eventId) return notFound("Activity not found in event");

  const subById = new Map(activity.subActivities.map((s) => [s.id, s]));
  const updatedEntries: {
    subActivityId: string;
    subActivityName: string;
    computedValue: number;
    priorComputedValue: number | null;
    isUpdate: boolean;
    scoreEntryId: string;
  }[] = [];

  await prisma.$transaction(async (tx) => {
    for (const entry of subEntries) {
      const sub = subById.get(entry.subActivityId);
      if (!sub) throw new Error("Sub-activity does not belong to activity");

      const subShape = {
        id: sub.id,
        name: sub.name,
        inputRule: sub.inputRule,
        sortDirection: sub.sortDirection,
        inputFields: sub.inputFields.map((f) => ({
          id: f.id,
          label: f.label,
          targetValue: f.targetValue,
        })),
      };

      const computed = validateAndComputeSub(subShape, entry.raws);

      const result = await persistSubScore(tx, {
        teamId,
        sub: subShape,
        raws: entry.raws,
        adminId: auth.adminId,
        computed,
      });

      updatedEntries.push({
        subActivityId: sub.id,
        subActivityName: sub.name,
        computedValue: result.computedValue,
        priorComputedValue: result.priorComputedValue,
        isUpdate: result.isUpdate,
        scoreEntryId: result.scoreEntryId,
      });
    }
  });

  // Audit each sub-activity score that was saved.
  for (const e of updatedEntries) {
    await audit({
      adminId: auth.adminId,
      action: e.isUpdate ? "update" : "create",
      entityType: "score",
      entityId: e.scoreEntryId,
      eventId: team.eventId,
      summary: e.isUpdate
        ? `Updated ${activity.name} → ${e.subActivityName} for team #${team.teamNumber} ${team.name} (${e.priorComputedValue} → ${e.computedValue})`
        : `Logged ${activity.name} → ${e.subActivityName} for team #${team.teamNumber} ${team.name} = ${e.computedValue}`,
      details: {
        teamId: team.id,
        teamNumber: team.teamNumber,
        teamName: team.name,
        activityId: activity.id,
        activityName: activity.name,
        subActivityId: e.subActivityId,
        subActivityName: e.subActivityName,
        oldComputedValue: e.priorComputedValue,
        newComputedValue: e.computedValue,
      },
    });
  }

  await publishEvent({
    type: "score_updated",
    eventId: team.eventId,
    payload: {
      teamId,
      activityId,
      entries: updatedEntries.map((e) => ({
        subActivityId: e.subActivityId,
        computedValue: e.computedValue,
      })),
    },
    ts: Date.now(),
  });

  return NextResponse.json({
    ok: true,
    entries: updatedEntries.map((e) => ({
      subActivityId: e.subActivityId,
      computedValue: e.computedValue,
    })),
  });
}
