"use client";
import { Leaderboard } from "@/components/Leaderboard";

export default function PublicEvent({ params }: { params: { id: string } }) {
  return <Leaderboard eventId={params.id} variant="public" />;
}
