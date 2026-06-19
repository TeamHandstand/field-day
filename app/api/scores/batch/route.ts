import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { validateAndComputeSub, persistSubScore } from "@/lib/scoring-save";
import { publishEvent } from "@/lib/pubnub-server";
import { audit } from "@/lib/audit";

// Saves one sub-activity's score for many teams in a single transaction.
const schema = z.object({
  activityId: z.string(),
  subActivityId: z.string(),
  teams: z
    .array(
      z.object({
        teamId: z.string(),
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
  if (!parsed.success) return badRequest("Invalid batch score", parsed.error.flatten());
  const { activityId, subActivityId, teams } = parsed.data;

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: { event: true, subActivities: { include: { inputFields: true } } },
  });
  if (!activity) return notFound("Activity not found");
  if (activity.event.isLocked) return badRequest("Event is locked");

  const sub = activity.subActivities.find((s) => s.id === subActivityId);
  if (!sub) return notFound("Sub-activity not found in activity");

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

  // Validate every team belongs to this event before writing anything.
  const teamIds = teams.map((t) => t.teamId);
  const teamRows = await prisma.team.findMany({
    where: { id: { in: teamIds }, eventId: activity.eventId },
  });
  if (teamRows.length !== teamIds.length) {
    return badRequest("One or more teams do not belong to this event");
  }
  const teamById = new Map(teamRows.map((t) => [t.id, t]));

  const saved: {
    teamId: string;
    teamNumber: number;
    teamName: string;
    scoreEntryId: string;
    computedValue: number;
    priorComputedValue: number | null;
    isUpdate: boolean;
  }[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      for (const entry of teams) {
        const computed = validateAndComputeSub(subShape, entry.raws);
        const result = await persistSubScore(tx, {
          teamId: entry.teamId,
          sub: subShape,
          raws: entry.raws,
          adminId: auth.adminId,
          computed,
        });
        const team = teamById.get(entry.teamId)!;
        saved.push({
          teamId: entry.teamId,
          teamNumber: team.teamNumber,
          teamName: team.name,
          scoreEntryId: result.scoreEntryId,
          computedValue: result.computedValue,
          priorComputedValue: result.priorComputedValue,
          isUpdate: result.isUpdate,
        });
      }
    });
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Save failed");
  }

  for (const s of saved) {
    await audit({
      adminId: auth.adminId,
      action: s.isUpdate ? "update" : "create",
      entityType: "score",
      entityId: s.scoreEntryId,
      eventId: activity.eventId,
      summary: s.isUpdate
        ? `Updated ${activity.name} → ${sub.name} for team #${s.teamNumber} ${s.teamName} (${s.priorComputedValue} → ${s.computedValue})`
        : `Logged ${activity.name} → ${sub.name} for team #${s.teamNumber} ${s.teamName} = ${s.computedValue}`,
      details: {
        teamId: s.teamId,
        teamNumber: s.teamNumber,
        teamName: s.teamName,
        activityId: activity.id,
        activityName: activity.name,
        subActivityId: sub.id,
        subActivityName: sub.name,
        oldComputedValue: s.priorComputedValue,
        newComputedValue: s.computedValue,
      },
    });
  }

  await publishEvent({
    type: "score_updated",
    eventId: activity.eventId,
    payload: {
      activityId,
      subActivityId,
      teams: saved.map((s) => ({ teamId: s.teamId, computedValue: s.computedValue })),
    },
    ts: Date.now(),
  });

  return NextResponse.json({
    ok: true,
    results: saved.map((s) => ({
      teamId: s.teamId,
      subActivityId: sub.id,
      computedValue: s.computedValue,
    })),
  });
}
