import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { publishEvent } from "@/lib/pubnub-server";
import { audit } from "@/lib/audit";

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
  const before = await prisma.team.findUnique({ where: { id: params.id } });
  if (!before) return notFound();
  const updated = await prisma.team.update({
    where: { id: params.id },
    data: parsed.data,
  });
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (parsed.data.name !== undefined && parsed.data.name !== before.name) {
    changes.name = { from: before.name, to: updated.name };
  }
  if (parsed.data.teamNumber !== undefined && parsed.data.teamNumber !== before.teamNumber) {
    changes.teamNumber = { from: before.teamNumber, to: updated.teamNumber };
  }
  if (parsed.data.cohortNumber !== undefined && parsed.data.cohortNumber !== before.cohortNumber) {
    changes.cohortNumber = { from: before.cohortNumber, to: updated.cohortNumber };
  }
  await audit({
    adminId: auth.adminId,
    action: "update",
    entityType: "team",
    entityId: updated.id,
    eventId: updated.eventId,
    summary: `Updated team #${updated.teamNumber} "${updated.name}"`,
    details: changes,
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
  await audit({
    adminId: auth.adminId,
    action: "delete",
    entityType: "team",
    entityId: team.id,
    eventId: team.eventId,
    summary: `Deleted team #${team.teamNumber} "${team.name}"`,
  });
  await publishEvent({ type: "team_changed", eventId: team.eventId, ts: Date.now() });
  return NextResponse.json({ ok: true });
}
