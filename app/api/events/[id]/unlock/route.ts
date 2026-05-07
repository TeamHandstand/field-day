import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, notFound } from "@/lib/api";
import { publishEvent } from "@/lib/pubnub-server";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return notFound();
  await prisma.event.update({
    where: { id: params.id },
    data: { isLocked: false, lockedAt: null },
  });
  await publishEvent({ type: "event_unlocked", eventId: params.id, ts: Date.now() });
  return NextResponse.json({ ok: true });
}
