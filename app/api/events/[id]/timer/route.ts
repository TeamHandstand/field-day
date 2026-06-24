import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { publishEvent } from "@/lib/pubnub-server";
import { audit } from "@/lib/audit";

// Shape returned to every client. serverNow lets clients correct for clock skew
// between phones so the derived countdown stays in sync regardless of device.
function timerState(event: {
  timerRunning: boolean;
  timerStartedAt: Date | null;
  timerDurationSeconds: number;
}) {
  return {
    running: event.timerRunning,
    startedAt: event.timerStartedAt ? event.timerStartedAt.getTime() : null,
    durationSeconds: event.timerDurationSeconds,
    serverNow: Date.now(),
  };
}

const SELECT = {
  id: true,
  timerRunning: true,
  timerStartedAt: true,
  timerDurationSeconds: true,
} as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const event = await prisma.event.findUnique({ where: { id: params.id }, select: SELECT });
  if (!event) return notFound();
  return NextResponse.json({ timer: timerState(event) });
}

const schema = z.object({
  action: z.enum(["start", "stop", "set_duration"]),
  // Optional new countdown length. Accepted on start (set + start) and required
  // for set_duration. 1s … 10h.
  durationSeconds: z.number().int().min(1).max(36000).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid timer action", parsed.error.flatten());
  const { action, durationSeconds } = parsed.data;

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { ...SELECT, name: true },
  });
  if (!event) return notFound();

  // start: (re)start the countdown from the (optionally updated) duration.
  // stop: halt and reset. set_duration: change the length without starting
  // (ignored while running so we don't yank time out from under a live count).
  let data: {
    timerRunning?: boolean;
    timerStartedAt?: Date | null;
    timerDurationSeconds?: number;
  };
  if (action === "start") {
    data = { timerRunning: true, timerStartedAt: new Date() };
    if (durationSeconds != null) data.timerDurationSeconds = durationSeconds;
  } else if (action === "stop") {
    data = { timerRunning: false, timerStartedAt: null };
  } else {
    if (durationSeconds == null) return badRequest("durationSeconds required");
    if (event.timerRunning) return badRequest("Stop the timer before changing its length");
    data = { timerDurationSeconds: durationSeconds };
  }

  const updated = await prisma.event.update({
    where: { id: params.id },
    data,
    select: SELECT,
  });

  const summaryByAction: Record<typeof action, string> = {
    start: `Started the ${Math.round(updated.timerDurationSeconds / 60)}-minute event timer for "${event.name}"`,
    stop: `Stopped and reset the event timer for "${event.name}"`,
    set_duration: `Set the event timer length to ${Math.round(updated.timerDurationSeconds / 60)} minutes for "${event.name}"`,
  };
  await audit({
    adminId: auth.adminId,
    action: "update",
    entityType: "event",
    entityId: event.id,
    eventId: event.id,
    summary: summaryByAction[action],
    details: { action, durationSeconds: updated.timerDurationSeconds },
  });

  const state = timerState(updated);
  await publishEvent({
    type: "timer_updated",
    eventId: event.id,
    payload: {
      running: state.running,
      startedAt: state.startedAt,
      durationSeconds: state.durationSeconds,
    },
    ts: Date.now(),
  });

  return NextResponse.json({ timer: state });
}
