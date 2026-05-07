import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, notFound, badRequest } from "@/lib/api";
import { publishEvent } from "@/lib/pubnub-server";
import { audit } from "@/lib/audit";

export async function DELETE(_req: Request, { params }: { params: { entryId: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const entry = await prisma.scoreEntry.findUnique({
    where: { id: params.entryId },
    include: {
      team: { include: { event: true } },
      subActivity: { include: { activity: true } },
    },
  });
  if (!entry) return notFound();
  if (entry.team.event.isLocked) return badRequest("Event is locked");
  await prisma.scoreEntry.delete({ where: { id: params.entryId } });
  await audit({
    adminId: auth.adminId,
    action: "delete",
    entityType: "score",
    entityId: entry.id,
    eventId: entry.team.eventId,
    summary: `Deleted ${entry.subActivity.activity.name} → ${entry.subActivity.name} for team #${entry.team.teamNumber} ${entry.team.name} (was ${entry.computedValue})`,
    details: {
      teamId: entry.teamId,
      teamNumber: entry.team.teamNumber,
      teamName: entry.team.name,
      activityId: entry.subActivity.activityId,
      activityName: entry.subActivity.activity.name,
      subActivityId: entry.subActivityId,
      subActivityName: entry.subActivity.name,
      oldComputedValue: entry.computedValue,
    },
  });
  await publishEvent({
    type: "score_deleted",
    eventId: entry.team.eventId,
    payload: { teamId: entry.teamId, subActivityId: entry.subActivityId },
    ts: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
