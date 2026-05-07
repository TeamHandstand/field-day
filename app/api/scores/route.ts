import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { computeValue } from "@/lib/scoring";
import { publishEvent } from "@/lib/pubnub-server";

// Saves all sub-activity scores for one (team, activity) pair in a single call.
// Body: { teamId, activityId, subEntries: [{ subActivityId, raws: {inputFieldId: number} }] }
const schema = z.object({
  teamId: z.string(),
  activityId: z.string(),
  subEntries: z
    .array(
      z.object({
        subActivityId: z.string(),
        raws: z.record(z.string(), z.number()),
      }),
    )
    .min(1),
});

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid score", parsed.error.flatten());
  const { teamId, activityId, subEntries } = parsed.data;

  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { event: true } });
  if (!team) return notFound("Team not found");
  if (team.event.isLocked) return badRequest("Event is locked");

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      subActivities: { include: { inputFields: true } },
    },
  });
  if (!activity || activity.eventId !== team.eventId) return notFound("Activity not found in event");

  const subById = new Map(activity.subActivities.map((s) => [s.id, s]));
  const updatedEntries: { subActivityId: string; computedValue: number }[] = [];

  await prisma.$transaction(async (tx) => {
    for (const entry of subEntries) {
      const sub = subById.get(entry.subActivityId);
      if (!sub) throw new Error("Sub-activity does not belong to activity");

      // Validate every required input is present.
      for (const f of sub.inputFields) {
        if (typeof entry.raws[f.id] !== "number") {
          throw new Error(`Missing input ${f.label}`);
        }
      }
      // Validate targets for deviation rules.
      if (sub.inputRule === "sum_of_pct_deviation") {
        for (const f of sub.inputFields) {
          if (f.targetValue == null || f.targetValue === 0) {
            throw new Error(`Sub-activity "${sub.name}" needs non-zero targets`);
          }
        }
      }
      if (sub.inputRule === "abs_deviation_from_target") {
        for (const f of sub.inputFields) {
          if (f.targetValue == null) throw new Error(`"${sub.name}" needs a target`);
        }
      }

      const computed = computeValue(
        {
          id: sub.id,
          inputRule: sub.inputRule,
          sortDirection: sub.sortDirection,
          inputFields: sub.inputFields.map((f) => ({ id: f.id, targetValue: f.targetValue })),
        },
        entry.raws,
      );

      const prior = await tx.scoreEntry.findUnique({
        where: { teamId_subActivityId: { teamId, subActivityId: sub.id } },
        include: { inputs: true },
      });

      const saved = await tx.scoreEntry.upsert({
        where: { teamId_subActivityId: { teamId, subActivityId: sub.id } },
        create: {
          teamId,
          subActivityId: sub.id,
          computedValue: computed,
          createdByAdminId: auth.adminId,
        },
        update: { computedValue: computed },
      });

      // Replace inputs.
      await tx.scoreInput.deleteMany({ where: { scoreEntryId: saved.id } });
      await tx.scoreInput.createMany({
        data: sub.inputFields.map((f) => ({
          scoreEntryId: saved.id,
          inputFieldId: f.id,
          rawValue: entry.raws[f.id],
        })),
      });

      await tx.scoreEditLog.create({
        data: {
          scoreEntryId: saved.id,
          adminId: auth.adminId,
          action: prior ? "update" : "create",
          fieldChanged: "computedValue",
          oldValue: prior ? String(prior.computedValue) : null,
          newValue: String(computed),
        },
      });

      updatedEntries.push({ subActivityId: sub.id, computedValue: computed });
    }
  });

  await publishEvent({
    type: "score_updated",
    eventId: team.eventId,
    payload: { teamId, activityId, entries: updatedEntries },
    ts: Date.now(),
  });

  return NextResponse.json({ ok: true, entries: updatedEntries });
}
