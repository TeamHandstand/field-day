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

const csvSchema = z.object({
  teams: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        teamNumber: z.number().int().min(1),
        cohortNumber: z.number().int().min(1).nullable().optional(),
        roster: z
          .array(
            z.object({
              firstName: z.string().trim().min(1).max(80),
              lastName: z.string().trim().min(1).max(80),
            }),
          )
          .max(50)
          .optional(),
      }),
    )
    .min(1)
    .max(500),
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

  if ("teams" in body) {
    const parsed = csvSchema.safeParse(body);
    if (!parsed.success) return badRequest("Invalid CSV upload", parsed.error.flatten());
    const seen = new Set<number>();
    for (const t of parsed.data.teams) {
      if (seen.has(t.teamNumber)) {
        return badRequest(`Duplicate team number ${t.teamNumber} in upload`);
      }
      seen.add(t.teamNumber);
    }
    const created = await prisma.$transaction(
      parsed.data.teams.map((t) =>
        prisma.team.create({
          data: {
            eventId: params.id,
            name: t.name,
            teamNumber: t.teamNumber,
            cohortNumber: t.cohortNumber ?? null,
            rosterUsers: t.roster && t.roster.length > 0
              ? {
                  create: t.roster.map((r) => ({
                    firstName: r.firstName,
                    lastName: r.lastName,
                  })),
                }
              : undefined,
          },
        }),
      ),
    );
    const totalRoster = parsed.data.teams.reduce(
      (acc, t) => acc + (t.roster?.length ?? 0),
      0,
    );
    await audit({
      adminId: auth.adminId,
      action: "create_batch",
      entityType: "team",
      eventId: params.id,
      summary:
        totalRoster > 0
          ? `Imported ${created.length} team${created.length === 1 ? "" : "s"} (+${totalRoster} roster) from CSV`
          : `Imported ${created.length} team${created.length === 1 ? "" : "s"} from CSV`,
      details: { count: created.length, rosterCount: totalRoster, source: "csv" },
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
