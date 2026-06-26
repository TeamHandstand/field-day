"use client";
import { useCallback, useEffect, useState } from "react";
import { useEventChannel } from "@/lib/pubnub-client";
import type { LeaderboardData } from "@/lib/leaderboard";
import { ActivityScoreTable } from "./ActivityScoreTable";

// All of an event's per-activity leaderboards, stacked. Loads the leaderboard
// once and re-renders live as scores are logged.

type Props = {
  eventId: string;
  variant?: "admin" | "public";
};

export function ActivityBoards({ eventId, variant = "public" }: Props) {
  const [data, setData] = useState<LeaderboardData | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/events/${eventId}/leaderboard`);
    if (r.ok) setData(await r.json());
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  useEventChannel(eventId, () => load());

  if (!data || data.activities.length === 0) return null;

  const dark = variant === "public";

  return (
    <section className="space-y-6">
      <h2 className={dark ? "text-3xl font-bold" : "text-xl font-semibold"}>By activity</h2>
      {data.activities.map((a) => (
        <div key={a.id} className="space-y-2">
          <h3 className={dark ? "text-xl font-semibold" : "text-lg font-semibold"}>{a.name}</h3>
          <ActivityScoreTable data={data} activityId={a.id} variant={variant} />
        </div>
      ))}
    </section>
  );
}
