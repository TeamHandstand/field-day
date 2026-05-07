import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { publishEvent } from "@/lib/pubnub-server";
import { audit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const activity = await prisma.activity.findUnique({
    where: { id: params.id },
    include: {
      event: true,
      subActivities: {
        orderBy: { displayOrder: "asc" },
        include: { inputFields: { orderBy: { displayOrder: "asc" } } },
      },
    },
  });
  if (!activity) return notFound();
  return NextResponse.json({ activity });
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  inputFieldUpdates: z
    .array(
      z.object({
        id: z.string(),
        targetValue: z.number().nullable().optional(),
        label: z.string().min(1).max(120).optional(),
        unit: z.string().min(1).max(40).optional(),
      }),
    )
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const activity = await prisma.activity.findUnique({
    where: { id: params.id },
    include: { event: true },
  });
  if (!activity) return notFound();
  if (activity.event.isLocked) return badRequest("Event is locked");
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid", parsed.error.flatten());

  await prisma.$transaction(async (tx) => {
    if (parsed.data.name || parsed.data.description !== undefined) {
      await tx.activity.update({
        where: { id: params.id },
        data: {
          name: parsed.data.name,
          description: parsed.data.description,
        },
      });
    }
    for (const upd of parsed.data.inputFieldUpdates ?? []) {
      const data: Record<string, unknown> = {};
      if (upd.targetValue !== undefined) data.targetValue = upd.targetValue;
      if (upd.label !== undefined) data.label = upd.label;
      if (upd.unit !== undefined) data.unit = upd.unit;
      if (Object.keys(data).length > 0) {
        await tx.inputField.update({ where: { id: upd.id }, data });
      }
    }
  });

  await audit({
    adminId: auth.adminId,
    action: "update",
    entityType: "activity",
    entityId: params.id,
    eventId: activity.eventId,
    summary: `Configured activity "${parsed.data.name ?? activity.name}"`,
    details: parsed.data,
  });
  await publishEvent({ type: "activity_changed", eventId: activity.eventId, ts: Date.now() });
  const updated = await prisma.activity.findUnique({
    where: { id: params.id },
    include: {
      subActivities: {
        orderBy: { displayOrder: "asc" },
        include: { inputFields: { orderBy: { displayOrder: "asc" } } },
      },
    },
  });
  return NextResponse.json({ activity: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const activity = await prisma.activity.findUnique({
    where: { id: params.id },
    include: { event: true },
  });
  if (!activity) return notFound();
  if (activity.event.isLocked) return badRequest("Event is locked");
  await prisma.activity.delete({ where: { id: params.id } });
  await audit({
    adminId: auth.adminId,
    action: "delete",
    entityType: "activity",
    entityId: activity.id,
    eventId: activity.eventId,
    summary: `Removed activity "${activity.name}"`,
  });
  await publishEvent({ type: "activity_changed", eventId: activity.eventId, ts: Date.now() });
  return NextResponse.json({ ok: true });
}
