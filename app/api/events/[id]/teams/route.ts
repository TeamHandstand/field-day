import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest } from "@/lib/api";
import { publishEvent } from "@/lib/pubnub-server";
import { audit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const teams = await prisma.team.findMany({
    where: { eventId: params.id },
    orderBy: { teamNumber: "asc" },
    include: { photos: { orderBy: { displayOrder: "asc" } }, rosterUsers: true },
  });
  return NextResponse.json({ teams });
}

const singleSchema = z.object({
  name: z.string().min(1).max(120),
  teamNumber: z.number().int().min(1),
  cohortNumber: z.number().int().min(1).nullable().optional(),
});

const batchSchema = z.object({
  count: z.number().int().min(1).max(100),
  startNumber: z.number().int().min(1).default(1),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();

  if ("count" in body) {
    const parsed = batchSchema.safeParse(body);
    if (!parsed.success) return badRequest("Invalid batch", parsed.error.flatten());
    const { count, startNumber } = parsed.data;
    const created = [];
    for (let i = 0; i < count; i++) {
      const teamNumber = startNumber + i;
      const t = await prisma.team.create({
        data: { eventId: params.id, teamNumber, name: `Team ${teamNumber}` },
      });
      created.push(t);
    }
    await audit({
      adminId: auth.adminId,
      action: "create_batch",
      entityType: "team",
      eventId: params.id,
      summary: `Pre-registered ${count} team${count === 1 ? "" : "s"} (#${startNumber}–#${startNumber + count - 1})`,
      details: { count, startNumber },
    });
    await publishEvent({ type: "team_changed", eventId: params.id, ts: Date.now() });
    return NextResponse.json({ teams: created });
  }

  const parsed = singleSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid team", parsed.error.flatten());
  const team = await prisma.team.create({
    data: {
      eventId: params.id,
      name: parsed.data.name,
      teamNumber: parsed.data.teamNumber,
      cohortNumber: parsed.data.cohortNumber ?? null,
    },
  });
  await audit({
    adminId: auth.adminId,
    action: "create",
    entityType: "team",
    entityId: team.id,
    eventId: params.id,
    summary: `Created team #${team.teamNumber} "${team.name}"`,
  });
  await publishEvent({ type: "team_changed", eventId: params.id, ts: Date.now() });
  return NextResponse.json({ team });
}
