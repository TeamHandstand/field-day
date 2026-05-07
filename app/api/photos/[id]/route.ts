import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, notFound } from "@/lib/api";
import { deleteObject, isS3Configured } from "@/lib/s3";
import { publishEvent } from "@/lib/pubnub-server";
import { audit } from "@/lib/audit";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const photo = await prisma.teamPhoto.findUnique({
    where: { id: params.id },
    include: { team: true },
  });
  if (!photo) return notFound();
  if (isS3Configured()) {
    await deleteObject(photo.s3Key);
  }
  await prisma.teamPhoto.delete({ where: { id: params.id } });
  await audit({
    adminId: auth.adminId,
    action: "delete",
    entityType: "photo",
    entityId: photo.id,
    eventId: photo.team.eventId,
    summary: `Deleted photo for team #${photo.team.teamNumber} ${photo.team.name}`,
    details: { s3Key: photo.s3Key },
  });
  await publishEvent({
    type: "team_changed",
    eventId: photo.team.eventId,
    payload: { teamId: photo.teamId },
    ts: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
