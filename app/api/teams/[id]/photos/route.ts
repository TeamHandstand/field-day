import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { publishEvent } from "@/lib/pubnub-server";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const photos = await prisma.teamPhoto.findMany({
    where: { teamId: params.id },
    orderBy: { displayOrder: "asc" },
  });
  return NextResponse.json({ photos });
}

const createSchema = z.object({
  cloudinaryUrl: z.string().url(),
  cloudinaryPublicId: z.string().min(1),
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
      cloudinaryUrl: parsed.data.cloudinaryUrl,
      cloudinaryPublicId: parsed.data.cloudinaryPublicId,
      displayOrder: (last?.displayOrder ?? -1) + 1,
    },
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
  await publishEvent({
    type: "team_changed",
    eventId: team.eventId,
    payload: { teamId: team.id },
    ts: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
