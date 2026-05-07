import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, notFound, badRequest } from "@/lib/api";
import { publishEvent } from "@/lib/pubnub-server";

export async function DELETE(_req: Request, { params }: { params: { entryId: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const entry = await prisma.scoreEntry.findUnique({
    where: { id: params.entryId },
    include: { team: { include: { event: true } } },
  });
  if (!entry) return notFound();
  if (entry.team.event.isLocked) return badRequest("Event is locked");
  await prisma.scoreEditLog.create({
    data: {
      scoreEntryId: entry.id,
      adminId: auth.adminId,
      action: "delete",
      oldValue: String(entry.computedValue),
    },
  });
  await prisma.scoreEntry.delete({ where: { id: params.entryId } });
  await publishEvent({
    type: "score_deleted",
    eventId: entry.team.eventId,
    payload: { teamId: entry.teamId, subActivityId: entry.subActivityId },
    ts: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
