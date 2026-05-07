import { NextResponse } from "next/server";
import { loadLeaderboard } from "@/lib/leaderboard";
import { notFound } from "@/lib/api";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const data = await loadLeaderboard(params.id);
  if (!data) return notFound();
  return NextResponse.json(data);
}
