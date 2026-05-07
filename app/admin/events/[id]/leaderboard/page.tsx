"use client";
import Link from "next/link";
import { Leaderboard } from "@/components/Leaderboard";

export default function EventLeaderboardPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-4">
      <Link href={`/admin/events/${params.id}`} className="text-sm text-slate-500 hover:text-brand">
        ← Event
      </Link>
      <Leaderboard eventId={params.id} variant="admin" />
    </div>
  );
}
