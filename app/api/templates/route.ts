import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest } from "@/lib/api";
import { activityInput } from "@/lib/zod-shapes";

export async function GET() {
  const templates = await prisma.activityTemplate.findMany({
    orderBy: [{ isSystemSeeded: "desc" }, { name: "asc" }],
    include: {
      subActivities: {
        orderBy: { displayOrder: "asc" },
        include: { inputFields: { orderBy: { displayOrder: "asc" } } },
      },
    },
  });
  return NextResponse.json({ templates });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = activityInput.safeParse(body);
  if (!parsed.success) return badRequest("Invalid template", parsed.error.flatten());
  const t = await prisma.activityTemplate.create({
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
  return NextResponse.json({ template: t });
}
