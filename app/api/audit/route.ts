import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api";

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get("eventId");
  const adminId = searchParams.get("adminId");
  const entityType = searchParams.get("entityType");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "200", 10) || 200, 1000);
  const log = await prisma.auditLog.findMany({
    where: {
      ...(eventId ? { eventId } : {}),
      ...(adminId ? { adminId } : {}),
      ...(entityType ? { entityType } : {}),
    },
    orderBy: { changedAt: "desc" },
    take: limit,
  });
  return NextResponse.json({ log });
}
