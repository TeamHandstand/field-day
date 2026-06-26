"use client";
import { Leaderboard } from "@/components/Leaderboard";
import { ActivityBoards } from "@/components/ActivityBoards";

export default function PublicEvent({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-12">
      <Leaderboard eventId={params.id} variant="public" />
      <ActivityBoards eventId={params.id} variant="public" />
    </div>
  );
}
