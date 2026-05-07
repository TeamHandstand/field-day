import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, notFound, badRequest } from "@/lib/api";
import { activityInput } from "@/lib/zod-shapes";
import { audit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const template = await prisma.activityTemplate.findUnique({
    where: { id: params.id },
    include: {
      subActivities: {
        orderBy: { displayOrder: "asc" },
        include: { inputFields: { orderBy: { displayOrder: "asc" } } },
      },
    },
  });
  if (!template) return notFound();
  return NextResponse.json({ template });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = activityInput.safeParse(body);
  if (!parsed.success) return badRequest("Invalid template", parsed.error.flatten());

  const t = await prisma.$transaction(async (tx) => {
    const existing = await tx.activityTemplate.findUnique({ where: { id: params.id } });
    if (!existing) throw new Error("Not found");
    await tx.subActivityTemplate.deleteMany({ where: { activityTemplateId: params.id } });
    return tx.activityTemplate.update({
      where: { id: params.id },
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? "",
        aggregationRule: parsed.data.aggregationRule,
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
                defaultTargetValue: f.defaultTargetValue ?? null,
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
  });
  await audit({
    adminId: auth.adminId,
    action: "update",
    entityType: "template",
    entityId: t.id,
    summary: `Updated template "${t.name}"`,
  });
  return NextResponse.json({ template: t });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const existing = await prisma.activityTemplate.findUnique({ where: { id: params.id } });
  if (!existing) return notFound();
  await prisma.activityTemplate.delete({ where: { id: params.id } });
  await audit({
    adminId: auth.adminId,
    action: "delete",
    entityType: "template",
    entityId: existing.id,
    summary: `Deleted template "${existing.name}"`,
  });
  return NextResponse.json({ ok: true });
}
