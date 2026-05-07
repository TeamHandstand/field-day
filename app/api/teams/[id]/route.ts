import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { publishEvent } from "@/lib/pubnub-server";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const team = await prisma.team.findUnique({
    where: { id: params.id },
    include: {
      photos: { orderBy: { displayOrder: "asc" } },
      rosterUsers: true,
    },
  });
  if (!team) return notFound();
  return NextResponse.json({ team });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = z
    .object({
      name: z.string().min(1).max(120).optional(),
      teamNumber: z.number().int().min(1).optional(),
      cohortNumber: z.number().int().min(1).nullable().optional(),
    })
    .safeParse(body);
  if (!parsed.success) return badRequest("Invalid team", parsed.error.flatten());
  const updated = await prisma.team.update({
    where: { id: params.id },
    data: parsed.data,
  });
  await publishEvent({
    type: "team_changed",
    eventId: updated.eventId,
    payload: { teamId: updated.id },
    ts: Date.now(),
  });
  return NextResponse.json({ team: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const team = await prisma.team.findUnique({ where: { id: params.id } });
  if (!team) return notFound();
  await prisma.team.delete({ where: { id: params.id } });
  await publishEvent({ type: "team_changed", eventId: team.eventId, ts: Date.now() });
  return NextResponse.json({ ok: true });
}
