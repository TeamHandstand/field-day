import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const admins = await prisma.admin.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  return NextResponse.json({ admins });
}

const createSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().max(120).optional().nullable(),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid admin", parsed.error.flatten());
  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) return badRequest("An admin with that email already exists");
  const hashed = await bcrypt.hash(parsed.data.password, 10);
  const admin = await prisma.admin.create({
    data: { email, name: parsed.data.name ?? null, hashedPassword: hashed },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  await audit({
    adminId: auth.adminId,
    action: "create",
    entityType: "admin",
    entityId: admin.id,
    summary: `Added admin ${admin.email}`,
  });
  return NextResponse.json({ admin });
}
