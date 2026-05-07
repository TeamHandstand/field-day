"use client";
import { useCallback, useEffect, useState } from "react";
import { useEventChannel } from "@/lib/pubnub-client";
import type { LeaderboardData } from "@/lib/leaderboard";
import { explainActivity } from "@/lib/explain";

type Props = {
  eventId: string;
  activityId: string;
  variant?: "admin" | "public";
};

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

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
  const finA = data.finalized?.activities.find((a) => a.activityId === activityId);

  const cohorts = Array.from(
    new Set(data.teams.map((t) => t.cohortNumber).filter((n): n is number => n != null)),
  ).sort((a, b) => a - b);

  const visibleTeams = data.teams.filter(
    (t) => cohort === "all" || t.cohortNumber === parseInt(cohort, 10),
  );

  // Compute computed values per team for this activity (single sub-activity case)
  // and aggregated rank when sum_of_ranks. Already in liveActivityRanks for global cohort.
  // For cohort filter, ranks are recomputed from scratch over the visible cohort.
  const subIds = activity.subActivities.map((s) => s.id);
  const visibleIds = new Set(visibleTeams.map((t) => t.id));

  const cohortScores = data.scores.filter(
    (s) => s.activityId === activityId && visibleIds.has(s.teamId),
  );

  type Row = {
    teamId: string;
    rank: number | null;
    points?: number;
    computed?: number;
    excluded?: boolean;
  };

  let rows: Row[] = [];

  if (isFinalized && finA) {
    rows = visibleTeams.map((t) => ({
      teamId: t.id,
      rank: finA.activityRanks[t.id] ?? null,
      points: finA.points[t.id] ?? 0,
      excluded: finA.excluded.includes(t.id),
    }));
  } else if (cohort === "all") {
    rows = visibleTeams.map((t) => ({
      teamId: t.id,
      rank: data.liveActivityRanks[activityId]?.[t.id] ?? null,
    }));
  } else {
    // Recompute cohort-only ranks client-side using the same engine (locally lightweight).
    const grouped = new Map<string, { teamId: string; computed: number }[]>();
    for (const sid of subIds) {
      grouped.set(
        sid,
        cohortScores
          .filter((s) => s.subActivityId === sid)
          .map((s) => ({ teamId: s.teamId, computed: s.computedValue })),
      );
    }
    const sub = activity.subActivities;
    const subRanks = new Map<string, Map<string, number>>();
    for (const s of sub) {
      const list = (grouped.get(s.id) ?? []).map((g) => ({ teamId: g.teamId, value: g.computed }));
      subRanks.set(s.id, rankAveraged(list, s.sortDirection));
    }
    const eligible = new Set<string>();
    for (const t of visibleTeams) {
      if (sub.every((s) => subRanks.get(s.id)?.has(t.id))) eligible.add(t.id);
    }
    let activityRanks: Map<string, number>;
    if (activity.aggregationRule === "single" && sub[0]) {
      activityRanks = new Map(
        Array.from(eligible).map((t) => [t, subRanks.get(sub[0].id)!.get(t)!]),
      );
    } else {
      const sums = Array.from(eligible).map((t) => ({
        teamId: t,
        value: sub.reduce((acc, s) => acc + (subRanks.get(s.id)!.get(t) ?? 0), 0),
      }));
      activityRanks = rankAveraged(sums, "asc");
    }
    rows = visibleTeams.map((t) => ({
      teamId: t.id,
      rank: activityRanks.get(t.id) ?? null,
      excluded: !eligible.has(t.id),
    }));
  }

  rows.sort((a, b) => {
    if (a.rank == null && b.rank == null) return 0;
    if (a.rank == null) return 1;
    if (b.rank == null) return -1;
    return a.rank - b.rank;
  });

  const teamById = new Map(data.teams.map((t) => [t.id, t]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={variant === "public" ? "text-3xl font-bold" : "text-xl font-semibold"}>
          {activity.name}
        </h2>
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

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-slate-500">
              <th className="px-2 py-2 text-left">Rank</th>
              <th className="px-2 py-2 text-left">Team</th>
              {activity.subActivities.map((s) => (
                <th key={s.id} className="px-2 py-2 text-center">
                  {s.name}
                </th>
              ))}
              {isFinalized && <th className="px-2 py-2 text-center">Points</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const t = teamById.get(row.teamId);
              if (!t) return null;
              return (
                <tr
                  key={row.teamId}
                  className={
                    variant === "public"
                      ? "rounded-lg bg-slate-800/60 text-slate-100"
                      : "rounded-lg bg-white shadow-sm"
                  }
                >
                  <td className="rounded-l-lg px-2 py-2 font-bold">
                    {row.excluded ? "—" : row.rank != null ? ordinal(Math.round(row.rank)) : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-slate-300 text-xs font-bold text-slate-700">
                        {t.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.photoUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          `#${t.teamNumber}`
                        )}
                      </div>
                      <div>
                        <div className="font-semibold">{t.name}</div>
                        <div className="text-xs text-slate-500">#{t.teamNumber}</div>
                      </div>
                    </div>
                  </td>
                  {activity.subActivities.map((s) => {
                    const score = data.scores.find(
                      (sc) =>
                        sc.activityId === activityId &&
                        sc.subActivityId === s.id &&
                        sc.teamId === row.teamId,
                    );
                    return (
                      <td key={s.id} className="px-2 py-2 text-center">
                        {score ? (
                          <span>
                            {fmt(score.computedValue)}
                            <span className="ml-1 text-xs text-slate-500">{s.inputFields[0]?.unit}</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                  {isFinalized && (
                    <td className="rounded-r-lg px-2 py-2 text-center font-bold">{row.points ?? 0}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
}

function rankAveraged(
  values: { teamId: string; value: number }[],
  sort: "asc" | "desc",
): Map<string, number> {
  if (values.length === 0) return new Map();
  const cmp = (a: number, b: number) => (sort === "asc" ? a - b : b - a);
  const sorted = [...values].sort((a, b) => cmp(a.value, b.value));
  const out = new Map<string, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j++;
    const avg = ((i + 1) + (j + 1)) / 2;
    for (let k = i; k <= j; k++) out.set(sorted[k].teamId, avg);
    i = j + 1;
  }
  return out;
}
