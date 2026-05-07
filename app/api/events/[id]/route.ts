import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: {
      teams: {
        orderBy: { teamNumber: "asc" },
        include: { photos: { orderBy: { displayOrder: "asc" } }, rosterUsers: true },
      },
      activities: {
        orderBy: { displayOrder: "asc" },
        include: {
          subActivities: {
            orderBy: { displayOrder: "asc" },
            include: { inputFields: { orderBy: { displayOrder: "asc" } } },
          },
        },
      },
    },
  });
  if (!event) return notFound();
  return NextResponse.json({ event });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = z.object({ name: z.string().min(1).max(120).optional() }).safeParse(body);
  if (!parsed.success) return badRequest("Invalid event", parsed.error.flatten());
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return notFound();
  if (event.isLocked) return badRequest("Event is locked. Unlock to edit.");
  const updated = await prisma.event.update({
    where: { id: params.id },
    data: parsed.data,
  });
  await audit({
    adminId: auth.adminId,
    action: "update",
    entityType: "event",
    entityId: updated.id,
    eventId: updated.id,
    summary: `Renamed event "${event.name}" → "${updated.name}"`,
    details: { oldName: event.name, newName: updated.name },
  });
  return NextResponse.json({ event: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const existing = await prisma.event.findUnique({ where: { id: params.id } });
  if (!existing) return notFound();
  await prisma.event.delete({ where: { id: params.id } });
  await audit({
    adminId: auth.adminId,
    action: "delete",
    entityType: "event",
    entityId: existing.id,
    eventId: null,
    summary: `Deleted event "${existing.name}"`,
  });
  return NextResponse.json({ ok: true });
}
