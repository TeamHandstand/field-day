import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = z
    .object({
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().min(1).max(80),
    })
    .safeParse(body);
  if (!parsed.success) return badRequest("Invalid roster user", parsed.error.flatten());
  const team = await prisma.team.findUnique({ where: { id: params.id } });
  if (!team) return notFound();
  const user = await prisma.rosterUser.create({
    data: {
      teamId: params.id,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
    },
  });
  await audit({
    adminId: auth.adminId,
    action: "create",
    entityType: "roster",
    entityId: user.id,
    eventId: team.eventId,
    summary: `Added "${user.firstName} ${user.lastName}" to team #${team.teamNumber} ${team.name}`,
  });
  return NextResponse.json({ rosterUser: user });
}
