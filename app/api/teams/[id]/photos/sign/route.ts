import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, badRequest, serverError } from "@/lib/api";
import { isS3Configured, presignPhotoPut } from "@/lib/s3";

const schema = z.object({ contentType: z.string().min(1) });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!isS3Configured()) {
    return serverError("S3 not configured");
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("contentType is required", parsed.error.flatten());
  try {
    const result = await presignPhotoPut(`field-day/teams/${params.id}`, parsed.data.contentType);
    return NextResponse.json(result);
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Could not sign upload");
  }
}
