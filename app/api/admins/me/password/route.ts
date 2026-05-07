import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid", parsed.error.flatten());
  const me = await prisma.admin.findUnique({ where: { id: auth.adminId } });
  if (!me) return notFound();
  const ok = await bcrypt.compare(parsed.data.currentPassword, me.hashedPassword);
  if (!ok) return badRequest("Current password is incorrect.");
  const hashed = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.admin.update({ where: { id: me.id }, data: { hashedPassword: hashed } });
  return NextResponse.json({ ok: true });
}
