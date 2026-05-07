import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const events = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { teams: true, activities: true } } },
  });
  return NextResponse.json({ events });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = z.object({ name: z.string().min(1).max(120) }).safeParse(body);
  if (!parsed.success) return badRequest("Invalid event", parsed.error.flatten());
  const event = await prisma.event.create({ data: { name: parsed.data.name } });
  await audit({
    adminId: auth.adminId,
    action: "create",
    entityType: "event",
    entityId: event.id,
    eventId: event.id,
    summary: `Created event "${event.name}"`,
  });
  return NextResponse.json({ event });
}
