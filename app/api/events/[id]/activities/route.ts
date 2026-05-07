import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { activityInput } from "@/lib/zod-shapes";
import { publishEvent } from "@/lib/pubnub-server";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const activities = await prisma.activity.findMany({
    where: { eventId: params.id },
    orderBy: { displayOrder: "asc" },
    include: {
      subActivities: {
        orderBy: { displayOrder: "asc" },
        include: { inputFields: { orderBy: { displayOrder: "asc" } } },
      },
    },
  });
  return NextResponse.json({ activities });
}

const fromTemplateSchema = z.object({ templateId: z.string(), insertAt: z.number().int().min(0).optional() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return notFound();
  if (event.isLocked) return badRequest("Event is locked");
  const body = await req.json();

  // Two modes: from template or full custom.
  if ("templateId" in body) {
    const parsed = fromTemplateSchema.safeParse(body);
    if (!parsed.success) return badRequest("Invalid", parsed.error.flatten());
    const template = await prisma.activityTemplate.findUnique({
      where: { id: parsed.data.templateId },
      include: {
        subActivities: {
          orderBy: { displayOrder: "asc" },
          include: { inputFields: { orderBy: { displayOrder: "asc" } } },
        },
      },
    });
    if (!template) return notFound("Template not found");

    const existing = await prisma.activity.findMany({
      where: { eventId: params.id },
      orderBy: { displayOrder: "asc" },
    });
    const insertAt = parsed.data.insertAt ?? existing.length;

    // Bump display order for activities at/after insertAt.
    await prisma.$transaction(
      existing
        .filter((a) => a.displayOrder >= insertAt)
        .map((a) =>
          prisma.activity.update({ where: { id: a.id }, data: { displayOrder: a.displayOrder + 1 } }),
        ),
    );

    const activity = await prisma.activity.create({
      data: {
        eventId: params.id,
        templateId: template.id,
        name: template.name,
        description: template.description,
        aggregationRule: template.aggregationRule,
        displayOrder: insertAt,
        subActivities: {
          create: template.subActivities.map((s, i) => ({
            name: s.name,
            displayOrder: i,
            inputRule: s.inputRule,
            sortDirection: s.sortDirection,
            inputFields: {
              create: s.inputFields.map((f, j) => ({
                label: f.label,
                unit: f.unit,
                targetValue: f.defaultTargetValue ?? null,
                displayOrder: j,
              })),
            },
          })),
        },
      },
      include: {
        subActivities: {
          orderBy: { displayOrder: "asc" },
          include: { inputFields: { orderBy: { displayOrder: "asc" } } },
        },
      },
    });
    await publishEvent({ type: "activity_changed", eventId: params.id, ts: Date.now() });
    return NextResponse.json({ activity });
  }

  const parsed = activityInput.safeParse(body);
  if (!parsed.success) return badRequest("Invalid activity", parsed.error.flatten());
  const last = await prisma.activity.findFirst({
    where: { eventId: params.id },
    orderBy: { displayOrder: "desc" },
  });
  const activity = await prisma.activity.create({
    data: {
      eventId: params.id,
      name: parsed.data.name,
      description: parsed.data.description ?? "",
      aggregationRule: parsed.data.aggregationRule,
      displayOrder: (last?.displayOrder ?? -1) + 1,
      subActivities: {
        create: parsed.data.subActivities.map((s, i) => ({
          name: s.name,
          displayOrder: i,
          inputRule: s.inputRule,
          sortDirection: s.sortDirection,
          inputFields: {
            create: s.inputFields.map((f, j) => ({
              label: f.label,
              unit: f.unit,
              targetValue: f.targetValue ?? null,
              displayOrder: j,
            })),
          },
        })),
      },
    },
    include: {
      subActivities: {
        orderBy: { displayOrder: "asc" },
        include: { inputFields: { orderBy: { displayOrder: "asc" } } },
      },
    },
  });
  await publishEvent({ type: "activity_changed", eventId: params.id, ts: Date.now() });
  return NextResponse.json({ activity });
}

const reorderSchema = z.object({ orderedIds: z.array(z.string()).min(1) });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return notFound();
  if (event.isLocked) return badRequest("Event is locked");
  const body = await req.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid reorder", parsed.error.flatten());
  await prisma.$transaction(
    parsed.data.orderedIds.map((id, idx) =>
      prisma.activity.update({ where: { id }, data: { displayOrder: idx } }),
    ),
  );
  await publishEvent({ type: "activity_changed", eventId: params.id, ts: Date.now() });
  return NextResponse.json({ ok: true });
}
