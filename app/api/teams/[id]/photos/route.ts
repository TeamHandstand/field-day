import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { publishEvent } from "@/lib/pubnub-server";
import { audit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const photos = await prisma.teamPhoto.findMany({
    where: { teamId: params.id },
    orderBy: { displayOrder: "asc" },
  });
  return NextResponse.json({ photos });
}

const createSchema = z.object({
  s3Url: z.string().url(),
  s3Key: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const team = await prisma.team.findUnique({ where: { id: params.id } });
  if (!team) return notFound();
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid photo", parsed.error.flatten());
  const last = await prisma.teamPhoto.findFirst({
    where: { teamId: params.id },
    orderBy: { displayOrder: "desc" },
  });
  const photo = await prisma.teamPhoto.create({
    data: {
      teamId: params.id,
      s3Url: parsed.data.s3Url,
      s3Key: parsed.data.s3Key,
      displayOrder: (last?.displayOrder ?? -1) + 1,
    },
  });
  await audit({
    adminId: auth.adminId,
    action: "create",
    entityType: "photo",
    entityId: photo.id,
    eventId: team.eventId,
    summary: `Uploaded photo for team #${team.teamNumber} ${team.name}`,
    details: { s3Key: photo.s3Key },
  });
  await publishEvent({
    type: "team_changed",
    eventId: team.eventId,
    payload: { teamId: team.id },
    ts: Date.now(),
  });
  return NextResponse.json({ photo });
}

const reorderSchema = z.object({ orderedIds: z.array(z.string()).min(1) });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const team = await prisma.team.findUnique({ where: { id: params.id } });
  if (!team) return notFound();
  const body = await req.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid reorder", parsed.error.flatten());
  await prisma.$transaction(
    parsed.data.orderedIds.map((id, idx) =>
      prisma.teamPhoto.update({ where: { id }, data: { displayOrder: idx } }),
    ),
  );
  await audit({
    adminId: auth.adminId,
    action: "reorder",
    entityType: "photo",
    eventId: team.eventId,
    summary: `Reordered photos for team #${team.teamNumber} ${team.name}`,
    details: { orderedIds: parsed.data.orderedIds },
  });
  await publishEvent({
    type: "team_changed",
    eventId: team.eventId,
    payload: { teamId: team.id },
    ts: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
