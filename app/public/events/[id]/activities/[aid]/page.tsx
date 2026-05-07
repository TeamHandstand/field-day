"use client";
import { ActivityLeaderboard } from "@/components/ActivityLeaderboard";

export default function PublicActivity({
  params,
}: {
  params: { id: string; aid: string };
}) {
  return <ActivityLeaderboard eventId={params.id} activityId={params.aid} variant="public" />;
}
