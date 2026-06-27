"use client";
import { useState } from "react";
import type { LeaderboardData } from "@/lib/leaderboard";
import { rankActivityLive, type ActivityShape, type SubActivityScore } from "@/lib/scoring";
import { formatMeasureWithUnit, formatDeviation, deviationToneClass } from "@/lib/format";

// Per-activity leaderboard table: teams ranked within one activity, showing each
// team's recorded value for every sub-activity. Where a field carries a target,
// the target is shown in the column header and the team's signed deviation is
// shown next to their value. Presentational only — the caller loads the data.

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

type Props = {
  data: LeaderboardData;
  activityId: string;
  variant?: "admin" | "public";
  // Restrict (and re-rank within) a subset of teams, e.g. a cohort. When omitted
  // every team is shown and event-wide ranks are used.
  visibleTeamIds?: string[];
};

export function ActivityScoreTable({ data, activityId, variant = "public", visibleTeamIds }: Props) {
  const activity = data.activities.find((a) => a.id === activityId);
  if (!activity) return null;

  const dark = variant === "public";
  const isFinalized = data.event.isFinalized && !!data.finalized;
  const finA = data.finalized?.activities.find((a) => a.activityId === activityId);

  // Optional override: sort rows by one sub-activity's rank so the winner of that
  // individual sub-activity rises to the top. Default sort is the activity rank.
  const [sortSubId, setSortSubId] = useState<string | null>(null);
  const activeSort =
    sortSubId && activity.subActivities.some((s) => s.id === sortSubId) ? sortSubId : null;

  const visibleSet = visibleTeamIds ? new Set(visibleTeamIds) : null;
  const visibleTeams = visibleSet ? data.teams.filter((t) => visibleSet.has(t.id)) : data.teams;
  const isSubset = visibleSet != null && visibleTeams.length !== data.teams.length;

  // Ranks: finalized snapshot when stamped; a fresh cohort-only computation when
  // filtering to a subset; otherwise the event-wide live ranks.
  let rankFor: (teamId: string) => number | null;
  let pointsFor: (teamId: string) => number | null = () => null;
  let excludedFor: (teamId: string) => boolean = () => false;

  if (isFinalized && finA) {
    rankFor = (t) => finA.activityRanks[t] ?? null;
    pointsFor = (t) => finA.points[t] ?? 0;
    excludedFor = (t) => finA.excluded.includes(t);
  } else if (isSubset) {
    const shape: ActivityShape = {
      id: activity.id,
      aggregationRule: activity.aggregationRule,
      subActivities: activity.subActivities.map((s) => ({
        id: s.id,
        inputRule: s.inputRule,
        sortDirection: s.sortDirection,
        inputFields: s.inputFields.map((f) => ({ id: f.id, targetValue: f.targetValue })),
      })),
    };
    const subset = new Set(visibleTeams.map((t) => t.id));
    const scores: SubActivityScore[] = data.scores
      .filter((s) => s.activityId === activityId && subset.has(s.teamId))
      .map((s) => ({ subActivityId: s.subActivityId, teamId: s.teamId, computedValue: s.computedValue }));
    const r = rankActivityLive(shape, scores, visibleTeams.map((t) => t.id));
    rankFor = (t) => r.ranks.get(t) ?? null;
    excludedFor = (t) => !r.ranks.has(t);
  } else {
    rankFor = (t) => data.liveActivityRanks[activityId]?.[t] ?? null;
  }

  const rows = visibleTeams
    .map((team) => ({
      team,
      rank: rankFor(team.id),
      points: pointsFor(team.id),
      excluded: excludedFor(team.id),
    }))
    .sort((a, b) => {
      // When sorting by a specific sub-activity, rank teams by that sub's rank.
      if (activeSort) {
        const ra = data.liveSubActivityRanks[activeSort]?.[a.team.id];
        const rb = data.liveSubActivityRanks[activeSort]?.[b.team.id];
        if (ra == null && rb == null) return a.team.teamNumber - b.team.teamNumber;
        if (ra == null) return 1;
        if (rb == null) return -1;
        if (ra !== rb) return ra - rb;
        return a.team.teamNumber - b.team.teamNumber;
      }
      if (a.rank == null && b.rank == null) return a.team.teamNumber - b.team.teamNumber;
      if (a.rank == null) return 1;
      if (b.rank == null) return -1;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.team.teamNumber - b.team.teamNumber;
    });

  const scoreFor = (teamId: string, subId: string) =>
    data.scores.find((s) => s.subActivityId === subId && s.teamId === teamId);

  // Target annotation shown under a sub-activity's column header.
  const subTargetText = (sub: LeaderboardData["activities"][number]["subActivities"][number]) => {
    const targeted = sub.inputFields.filter((f) => f.targetValue != null);
    if (targeted.length === 0) return null;
    const label = targeted.length === 1 ? "target" : "targets";
    return `${label} ${targeted.map((f) => formatMeasureWithUnit(f.targetValue!, f.unit)).join(", ")}`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-y-1 text-sm">
        <thead>
          <tr className={dark ? "text-slate-400" : "text-slate-500"}>
            <th className="px-2 py-2 text-left">Rank</th>
            <th className="px-2 py-2 text-left">Team</th>
            {activity.subActivities.map((s) => {
              const target = subTargetText(s);
              const sorted = activeSort === s.id;
              return (
                <th key={s.id} className="px-2 py-2 text-center">
                  <button
                    onClick={() => setSortSubId(sorted ? null : s.id)}
                    className={
                      sorted
                        ? "text-brand underline"
                        : dark
                          ? "hover:text-slate-200"
                          : "hover:text-brand"
                    }
                    aria-label={`Sort by ${s.name}`}
                    title={sorted ? "Click to clear sort" : `Sort by ${s.name}`}
                  >
                    {s.name}
                    <span className="ml-1 text-[10px]">{sorted ? "▼" : "↕"}</span>
                  </button>
                  {target && (
                    <div className={`text-xs font-normal ${dark ? "text-slate-500" : "text-slate-400"}`}>
                      {target}
                    </div>
                  )}
                </th>
              );
            })}
            {isFinalized && <th className="px-2 py-2 text-center">Points</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const t = row.team;
            return (
              <tr
                key={t.id}
                className={dark ? "bg-slate-800/60 text-slate-100" : "bg-white shadow-sm"}
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
                        `T${t.teamNumber}`
                      )}
                    </div>
                    <div>
                      <div className="font-semibold">{t.name}</div>
                      <div className={dark ? "text-xs text-slate-400" : "text-xs text-slate-500"}>
                        T{t.teamNumber}
                      </div>
                    </div>
                  </div>
                </td>
                {activity.subActivities.map((s) => {
                  const score = scoreFor(t.id, s.id);
                  const rawByField = new Map(
                    (score?.inputs ?? []).map((i) => [i.inputFieldId, i.rawValue]),
                  );
                  const multi = s.inputFields.length > 1;
                  const circular = s.inputRule === "circular_deviation";
                  return (
                    <td key={s.id} className="px-2 py-2 text-center align-top">
                      {!score ? (
                        "—"
                      ) : s.inputFields.length === 0 ? (
                        formatMeasureWithUnit(score.computedValue)
                      ) : (
                        <div className="space-y-0.5">
                          {s.inputFields.map((f) => {
                            const raw = rawByField.get(f.id);
                            if (raw == null) return <div key={f.id}>—</div>;
                            // Compass bearings always have a target (North = 0° by default).
                            const target = f.targetValue ?? (circular ? 0 : null);
                            const dev =
                              target != null ? formatDeviation(raw, target, f.unit, circular) : null;
                            return (
                              <div key={f.id}>
                                {multi && (
                                  <span className={`mr-1 text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
                                    {f.label}:
                                  </span>
                                )}
                                <span className="font-medium">{formatMeasureWithUnit(raw, f.unit)}</span>
                                {dev && (
                                  <span className={`ml-1 text-xs ${deviationToneClass(dev.tone)}`}>
                                    ({dev.text})
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
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
  );
}
