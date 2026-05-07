import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/api";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const activityId = searchParams.get("activityId");
  if (!activityId) return badRequest("activityId is required");
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: { subActivities: true },
  });
  if (!activity) return NextResponse.json({ entries: [] });
  const subIds = activity.subActivities.map((s) => s.id);
  const entries = await prisma.scoreEntry.findMany({
    where: { teamId: params.id, subActivityId: { in: subIds } },
    include: { inputs: true },
  });
  return NextResponse.json({
    entries: entries.map((e) => ({
      id: e.id,
      subActivityId: e.subActivityId,
      computedValue: e.computedValue,
      inputs: e.inputs.map((i) => ({ inputFieldId: i.inputFieldId, rawValue: i.rawValue })),
    })),
  });
}
