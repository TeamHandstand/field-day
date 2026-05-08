import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = z
    .object({
      firstName: z.string().trim().min(1).max(80).optional(),
      lastName: z.string().trim().min(1).max(80).optional(),
    })
    .safeParse(body);
  if (!parsed.success) return badRequest("Invalid roster user", parsed.error.flatten());
  const before = await prisma.rosterUser.findUnique({
    where: { id: params.id },
    include: { team: true },
  });
  if (!before) return notFound();
  const updated = await prisma.rosterUser.update({
    where: { id: params.id },
    data: parsed.data,
  });
  await audit({
    adminId: auth.adminId,
    action: "update",
    entityType: "roster",
    entityId: updated.id,
    eventId: before.team.eventId,
    summary: `Renamed roster member to "${updated.firstName} ${updated.lastName}" on team #${before.team.teamNumber} ${before.team.name}`,
    details: {
      from: { firstName: before.firstName, lastName: before.lastName },
      to: { firstName: updated.firstName, lastName: updated.lastName },
    },
  });
  return NextResponse.json({ rosterUser: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const user = await prisma.rosterUser.findUnique({
    where: { id: params.id },
    include: { team: true },
  });
  if (!user) return notFound();
  await prisma.rosterUser.delete({ where: { id: params.id } });
  await audit({
    adminId: auth.adminId,
    action: "delete",
    entityType: "roster",
    entityId: user.id,
    eventId: user.team.eventId,
    summary: `Removed "${user.firstName} ${user.lastName}" from team #${user.team.teamNumber} ${user.team.name}`,
  });
  return NextResponse.json({ ok: true });
}
