import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type AuditEntityType =
  | "event"
  | "team"
  | "activity"
  | "subActivity"
  | "inputField"
  | "template"
  | "photo"
  | "roster"
  | "admin"
  | "score";

export type AuditAction =
  | "create"
  | "create_batch"
  | "update"
  | "delete"
  | "reorder"
  | "finalize"
  | "unlock"
  | "password_change";

export type AuditInput = {
  adminId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  eventId?: string | null;
  summary: string;
  details?: Record<string, unknown> | null;
};

export async function audit(input: AuditInput): Promise<void> {
  let adminEmail: string | null = null;
  let adminName: string | null = null;
  if (input.adminId) {
    const a = await prisma.admin.findUnique({
      where: { id: input.adminId },
      select: { email: true, name: true },
    });
    adminEmail = a?.email ?? null;
    adminName = a?.name ?? null;
  }
  await prisma.auditLog.create({
    data: {
      adminId: input.adminId ?? null,
      adminEmail,
      adminName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      eventId: input.eventId ?? null,
      summary: input.summary,
      details:
        input.details == null
          ? Prisma.JsonNull
          : (input.details as Prisma.InputJsonValue),
    },
  });
}
