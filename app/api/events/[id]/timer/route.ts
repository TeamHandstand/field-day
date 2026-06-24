import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { publishEvent } from "@/lib/pubnub-server";
import { audit } from "@/lib/audit";

// Shape returned to every client. serverNow lets clients correct for clock skew
// between phones so the derived elapsed time stays in sync regardless of device.
function timerState(event: { timerRunning: boolean; timerStartedAt: Date | null }) {
  return {
    running: event.timerRunning,
    startedAt: event.timerStartedAt ? event.timerStartedAt.getTime() : null,
    serverNow: Date.now(),
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { id: true, timerRunning: true, timerStartedAt: true },
  });
  if (!event) return notFound();
  return NextResponse.json({ timer: timerState(event) });
}

const schema = z.object({ action: z.enum(["start", "stop"]) });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid timer action", parsed.error.flatten());

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, timerRunning: true, timerStartedAt: true },
  });
  if (!event) return notFound();

  // start: (re)start counting from zero. stop: halt and reset to zero. A single
  // stopwatch with one running flag keeps the shared state unambiguous.
  const data =
    parsed.data.action === "start"
      ? { timerRunning: true, timerStartedAt: new Date() }
      : { timerRunning: false, timerStartedAt: null };

  const updated = await prisma.event.update({
    where: { id: params.id },
    data,
    select: { id: true, timerRunning: true, timerStartedAt: true },
  });

  await audit({
    adminId: auth.adminId,
    action: "update",
    entityType: "event",
    entityId: event.id,
    eventId: event.id,
    summary:
      parsed.data.action === "start"
        ? `Started the event timer for "${event.name}"`
        : `Stopped and reset the event timer for "${event.name}"`,
    details: { action: parsed.data.action },
  });

  const state = timerState(updated);
  await publishEvent({
    type: "timer_updated",
    eventId: event.id,
    payload: { running: state.running, startedAt: state.startedAt },
    ts: Date.now(),
  });

  return NextResponse.json({ timer: state });
}
