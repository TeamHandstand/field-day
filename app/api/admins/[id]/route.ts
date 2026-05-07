import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (params.id === auth.adminId) {
    return badRequest("You can't delete your own account.");
  }
  const target = await prisma.admin.findUnique({ where: { id: params.id } });
  if (!target) return notFound();
  const total = await prisma.admin.count();
  if (total <= 1) {
    return badRequest("There must be at least one admin.");
  }
  await prisma.admin.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
