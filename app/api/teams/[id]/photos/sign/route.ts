import { NextResponse } from "next/server";
import { requireAdmin, serverError } from "@/lib/api";
import { isCloudinaryConfigured, signUpload } from "@/lib/cloudinary";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!isCloudinaryConfigured()) {
    return serverError("Cloudinary not configured");
  }
  const signed = signUpload(`field-day/teams/${params.id}`);
  return NextResponse.json(signed);
}
