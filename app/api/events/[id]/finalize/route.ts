import { NextResponse } from "next/server";
import { requireAdmin, badRequest } from "@/lib/api";
import { finalizeEvent, reportFinalizationGaps } from "@/lib/leaderboard";
import { publishEvent } from "@/lib/pubnub-server";
import { audit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const gaps = await reportFinalizationGaps(params.id);
  return NextResponse.json({ gaps });
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const result = await finalizeEvent(params.id);
    await audit({
      adminId: auth.adminId,
      action: "finalize",
      entityType: "event",
      entityId: params.id,
      eventId: params.id,
      summary: `Finalized event "${result.event.name}"`,
      details: { totalTeams: result.snapshot.totalTeams },
    });
    await publishEvent({ type: "event_finalized", eventId: params.id, ts: Date.now() });
    return NextResponse.json(result);
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Failed to finalize");
  }
}
