import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api";

export async function GET(_req: Request, { params }: { params: { entryId: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const log = await prisma.scoreEditLog.findMany({
    where: { scoreEntryId: params.entryId },
    orderBy: { changedAt: "desc" },
    include: { admin: true },
  });
  return NextResponse.json({ log });
}
