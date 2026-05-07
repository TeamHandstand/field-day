import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api";

export async function GET(_req: Request, { params }: { params: { entryId: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const log = await prisma.auditLog.findMany({
    where: { entityType: "score", entityId: params.entryId },
    orderBy: { changedAt: "desc" },
  });
  return NextResponse.json({ log });
}
