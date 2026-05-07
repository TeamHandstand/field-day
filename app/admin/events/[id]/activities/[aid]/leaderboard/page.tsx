"use client";
import Link from "next/link";
import { ActivityLeaderboard } from "@/components/ActivityLeaderboard";

export default function ActivityLeaderboardPage({
  params,
}: {
  params: { id: string; aid: string };
}) {
  return (
    <div className="space-y-4">
      <Link href={`/admin/events/${params.id}`} className="text-sm text-slate-500 hover:text-brand">
        ← Event
      </Link>
      <ActivityLeaderboard eventId={params.id} activityId={params.aid} variant="admin" />
    </div>
  );
}
