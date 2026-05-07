import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = z.object({ name: z.string().min(1).max(120) }).safeParse(body);
  if (!parsed.success) return badRequest("Invalid roster user", parsed.error.flatten());
  const team = await prisma.team.findUnique({ where: { id: params.id } });
  if (!team) return notFound();
  const user = await prisma.rosterUser.create({
    data: { teamId: params.id, name: parsed.data.name },
  });
  return NextResponse.json({ rosterUser: user });
}
