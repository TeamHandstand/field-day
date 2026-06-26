"use client";
import { useCallback, useEffect, useState } from "react";
import { useEventChannel } from "@/lib/pubnub-client";
import type { LeaderboardData } from "@/lib/leaderboard";
import { explainActivity } from "@/lib/explain";
import { ActivityScoreTable } from "./ActivityScoreTable";

type Props = {
  eventId: string;
  activityId: string;
  variant?: "admin" | "public";
};

export function ActivityLeaderboard({ eventId, activityId, variant = "admin" }: Props) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [cohort, setCohort] = useState("all");

  const load = useCallback(async () => {
    const r = await fetch(`/api/events/${eventId}/leaderboard`);
    if (r.ok) setData(await r.json());
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  useEventChannel(eventId, () => load());

  if (!data) return <p>Loading…</p>;
  const activity = data.activities.find((a) => a.id === activityId);
  if (!activity) return <p>Activity not found.</p>;

  const isFinalized = data.event.isFinalized && !!data.finalized;

  // Cohort filtering stays an admin-only convenience; the public boards show
  // every team.
  const showCohortFilter = variant === "admin";
  const cohorts = Array.from(
    new Set(data.teams.map((t) => t.cohortNumber).filter((n): n is number => n != null)),
  ).sort((a, b) => a - b);

  const visibleTeamIds =
    showCohortFilter && cohort !== "all"
      ? data.teams.filter((t) => t.cohortNumber === parseInt(cohort, 10)).map((t) => t.id)
      : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={variant === "public" ? "text-3xl font-bold" : "text-xl font-semibold"}>
          {activity.name}
        </h2>
        {showCohortFilter && cohorts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setCohort("all")}
              className={`btn ${cohort === "all" ? "btn-primary" : "btn-secondary"} text-sm`}
            >
              All
            </button>
            {cohorts.map((c) => (
              <button
                key={c}
                onClick={() => setCohort(String(c))}
                className={`btn ${cohort === String(c) ? "btn-primary" : "btn-secondary"} text-sm`}
              >
                Cohort {c}
              </button>
            ))}
          </div>
        )}
      </div>
      <p
        className={variant === "public" ? "text-slate-300" : "text-sm text-slate-600"}
        dangerouslySetInnerHTML={{
          __html: explainActivity(activity, data.teams.length).replace(
            /\*\*(.+?)\*\*/g,
            "<strong>$1</strong>",
          ),
        }}
      />
      {!isFinalized && (
        <p className={variant === "public" ? "text-slate-400" : "text-xs text-slate-500"}>
          Points awarded when event ends.
        </p>
      )}

      <ActivityScoreTable
        data={data}
        activityId={activityId}
        variant={variant}
        visibleTeamIds={visibleTeamIds}
      />
    </div>
  );
}
