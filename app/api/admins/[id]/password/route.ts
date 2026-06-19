import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { canResetAdminPasswords, DEFAULT_RESET_PASSWORD } from "@/lib/permissions";
import { audit } from "@/lib/audit";

// Resets another admin's password. Gated to PASSWORD_RESET_ALLOWED_EMAILS.
// Body: { newPassword?: string } — when omitted, resets to DEFAULT_RESET_PASSWORD.
const schema = z.object({
  newPassword: z.string().min(3).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  // Only allowlisted admins may reset others' passwords (see lib/permissions).
  const me = await prisma.admin.findUnique({ where: { id: auth.adminId } });
  if (!canResetAdminPasswords(me?.email)) {
    return NextResponse.json(
      { error: "You don't have permission to reset passwords." },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid", parsed.error.flatten());

  const target = await prisma.admin.findUnique({ where: { id: params.id } });
  if (!target) return notFound();

  const usedDefault = !parsed.data.newPassword;
  const newPassword = parsed.data.newPassword ?? DEFAULT_RESET_PASSWORD;
  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.admin.update({ where: { id: target.id }, data: { hashedPassword: hashed } });

  // Audit the action but never record the password value itself.
  await audit({
    adminId: auth.adminId,
    action: "password_change",
    entityType: "admin",
    entityId: target.id,
    summary: usedDefault
      ? `Reset password for ${target.email} to the default`
      : `Set a new password for ${target.email}`,
    details: { targetEmail: target.email, usedDefault },
  });

  return NextResponse.json({ ok: true, usedDefault });
}
