import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";

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
    summary: `Removed "${user.name}" from team #${user.team.teamNumber} ${user.team.name}`,
  });
  return NextResponse.json({ ok: true });
}
