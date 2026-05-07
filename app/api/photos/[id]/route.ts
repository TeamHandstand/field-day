import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, notFound } from "@/lib/api";
import { destroyAsset, isCloudinaryConfigured } from "@/lib/cloudinary";
import { publishEvent } from "@/lib/pubnub-server";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const photo = await prisma.teamPhoto.findUnique({
    where: { id: params.id },
    include: { team: true },
  });
  if (!photo) return notFound();
  if (isCloudinaryConfigured()) {
    await destroyAsset(photo.cloudinaryPublicId);
  }
  await prisma.teamPhoto.delete({ where: { id: params.id } });
  await publishEvent({
    type: "team_changed",
    eventId: photo.team.eventId,
    payload: { teamId: photo.teamId },
    ts: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
