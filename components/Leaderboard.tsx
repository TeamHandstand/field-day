"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useEventChannel } from "@/lib/pubnub-client";
import type { LeaderboardData } from "@/lib/leaderboard";
import { TeamScoreBreakdown } from "./TeamScoreBreakdown";

type Props = {
  eventId: string;
  variant?: "admin" | "public";
  initialCohort?: string;
};

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

type SortBy = { kind: "default" } | { kind: "activity"; activityId: string };

export function Leaderboard({ eventId, variant = "admin", initialCohort = "all" }: Props) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [cohort, setCohort] = useState(initialCohort);
  const [sortBy, setSortBy] = useState<SortBy>({ kind: "default" });
  // Which team's score breakdown is expanded inline. Click a row's caret to
  // drill into what that team actually scored on each activity/sub-activity.
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/events/${eventId}/leaderboard`);
    if (r.ok) setData(await r.json());
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  useEventChannel(eventId, () => load());

  if (!data) return <p>Loading…</p>;

  const cohorts = Array.from(
    new Set(data.teams.map((t) => t.cohortNumber).filter((n): n is number => n != null)),
  ).sort((a, b) => a - b);

  const visibleTeams = data.teams.filter(
    (t) => cohort === "all" || t.cohortNumber === parseInt(cohort, 10),
  );

  const finalized = data.finalized;
  const isFinalized = data.event.isFinalized && !!finalized;

  // Overall rank/total come from the finalized snapshot once stamped, otherwise
  // from the live (provisional) standings so the board updates as scores land.
  const globalRankFor = (teamId: string): number | undefined =>
    isFinalized ? finalized!.globalRanks[teamId] : data.liveStandings.globalRanks[teamId];
  const totalFor = (teamId: string): number | undefined =>
    isFinalized ? finalized!.totals[teamId] : data.liveStandings.totals[teamId];
  const fmtTotal = (n: number | undefined): string =>
    n == null ? "—" : Number.isInteger(n) ? n.toString() : n.toFixed(1);

  // Resolve the rank a team holds in a given activity column, picking the
  // finalized snapshot when available so the visible sort matches the visible numbers.
  const activityRankFor = (teamId: string, activityId: string): number | undefined => {
    if (isFinalized) {
      return finalized!.activities.find((a) => a.activityId === activityId)?.activityRanks[teamId];
    }
    return data.liveActivityRanks[activityId]?.[teamId];
  };

  const sortedTeams = [...visibleTeams].sort((a, b) => {
    if (sortBy.kind === "activity") {
      const ra = activityRankFor(a.id, sortBy.activityId);
      const rb = activityRankFor(b.id, sortBy.activityId);
      if (ra == null && rb == null) return a.teamNumber - b.teamNumber;
      if (ra == null) return 1;
      if (rb == null) return -1;
      if (ra !== rb) return ra - rb;
      return a.teamNumber - b.teamNumber;
    }
    const ra = globalRankFor(a.id);
    const rb = globalRankFor(b.id);
    if (ra != null && rb != null && ra !== rb) return ra - rb;
    if (ra != null && rb == null) return -1;
    if (ra == null && rb != null) return 1;
    return a.teamNumber - b.teamNumber;
  });

  const onHeaderClick = (activityId: string) => {
    setSortBy((prev) =>
      prev.kind === "activity" && prev.activityId === activityId
        ? { kind: "default" }
        : { kind: "activity", activityId },
    );
  };

  return (
    <div className={variant === "public" ? "space-y-4 text-slate-100" : "space-y-4"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={variant === "public" ? "text-3xl font-bold" : "text-xl font-semibold"}>
          {isFinalized ? "Final Results" : "Live Standings"} — {data.event.name}
        </h2>
        {/* Cohort filtering and CSV export are admin-only; the public board shows
            every team with no filters. */}
        {variant === "admin" && (
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
            <a
              href={`/api/export?eventId=${eventId}`}
              className="btn btn-secondary text-sm"
              title="Download this event's full scoring data as CSV"
            >
              Export CSV
            </a>
          </div>
        )}
      </div>

      {!isFinalized && (
        <p className={variant === "public" ? "text-slate-300" : "text-sm text-slate-500"}>
          Provisional standings — they update live as scores are logged. Final standings are
          published when the event ends.
        </p>
      )}

      {sortBy.kind === "activity" && (
        <div
          className={
            variant === "public"
              ? "flex items-center gap-2 text-sm text-slate-300"
              : "flex items-center gap-2 text-xs text-slate-500"
          }
        >
          <span>
            Sorted by{" "}
            <strong>
              {data.activities.find((a) => a.id === sortBy.activityId)?.name ?? "activity"}
            </strong>{" "}
            rank.
          </span>
          <button
            onClick={() => setSortBy({ kind: "default" })}
            className="underline hover:text-brand"
          >
            Reset
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table
          className={
            variant === "public"
              ? "min-w-full border-separate border-spacing-y-1 text-lg"
              : "min-w-full border-separate border-spacing-y-1 text-sm"
          }
        >
          <thead>
            <tr className={variant === "public" ? "text-slate-400" : "text-slate-500"}>
              <th className="w-6 px-1 py-2" aria-hidden />
              <th className="px-2 py-2 text-left">Rank</th>
              <th className="px-2 py-2 text-left">Team</th>
              {data.activities.map((a) => {
                const isSorted = sortBy.kind === "activity" && sortBy.activityId === a.id;
                return (
                  <th key={a.id} className="px-2 py-2 text-center">
                    <button
                      onClick={() => onHeaderClick(a.id)}
                      className={
                        isSorted
                          ? variant === "public"
                            ? "text-brand underline"
                            : "text-brand underline"
                          : variant === "public"
                            ? "hover:text-slate-200"
                            : "hover:text-brand"
                      }
                      aria-label={`Sort by ${a.name}`}
                      title={isSorted ? "Click to clear sort" : `Sort by ${a.name}`}
                    >
                      {a.name}
                      <span className="ml-1 text-[10px]">{isSorted ? "▼" : "↕"}</span>
                    </button>
                  </th>
                );
              })}
              <th className="px-2 py-2 text-center font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map((t) => {
              const globalRank = globalRankFor(t.id);
              const teamCellInner = (
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-slate-300 text-xs font-bold text-slate-700">
                    {t.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.photoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      `T${t.teamNumber}`
                    )}
                  </div>
                  <div>
                    <div className="font-semibold">{t.name}</div>
                    <div
                      className={
                        variant === "public" ? "text-xs text-slate-400" : "text-xs text-slate-500"
                      }
                    >
                      T{t.teamNumber}
                      {t.cohortNumber != null ? ` · Cohort ${t.cohortNumber}` : ""}
                    </div>
                  </div>
                </div>
              );
              const isExpanded = expandedTeam === t.id;
              return (
                <Fragment key={t.id}>
                <tr
                  className={
                    variant === "public"
                      ? "bg-slate-800/60"
                      : "bg-white shadow-sm"
                  }
                >
                  <td className={`${isExpanded ? "" : "rounded-l-lg"} px-1 py-2 text-center`}>
                    <button
                      onClick={() => setExpandedTeam(isExpanded ? null : t.id)}
                      aria-label={isExpanded ? "Collapse breakdown" : "Show breakdown"}
                      aria-expanded={isExpanded}
                      className={
                        variant === "public"
                          ? "text-slate-400 hover:text-slate-200"
                          : "text-slate-400 hover:text-brand"
                      }
                      title={isExpanded ? "Hide score breakdown" : "Show score breakdown"}
                    >
                      <span className="inline-block text-xs">{isExpanded ? "▾" : "▸"}</span>
                    </button>
                  </td>
                  <td className="px-2 py-2 font-bold">
                    {globalRank != null ? ordinal(Math.round(globalRank)) : "—"}
                  </td>
                  <td className="px-2 py-2">
                    {variant === "admin" ? (
                      <Link
                        href={`/admin/events/${eventId}/teams/${t.id}`}
                        className="block hover:text-brand"
                        title="Open team detail"
                      >
                        {teamCellInner}
                      </Link>
                    ) : (
                      teamCellInner
                    )}
                  </td>
                  {data.activities.map((a) => {
                    if (isFinalized) {
                      const finA = finalized!.activities.find((fa) => fa.activityId === a.id);
                      const r = finA?.activityRanks[t.id];
                      const p = finA?.points[t.id] ?? 0;
                      return (
                        <td key={a.id} className="px-2 py-2 text-center">
                          <div className="font-semibold">{p}</div>
                          <div
                            className={
                              variant === "public" ? "text-xs text-slate-400" : "text-xs text-slate-500"
                            }
                          >
                            {r != null ? `${ordinal(Math.round(r))}` : "—"}
                          </div>
                        </td>
                      );
                    }
                    const r = data.liveActivityRanks[a.id]?.[t.id];
                    return (
                      <td key={a.id} className="px-2 py-2 text-center">
                        <span
                          className={
                            variant === "public" ? "font-semibold" : "font-medium text-slate-700"
                          }
                        >
                          {r != null ? ordinal(Math.round(r)) : "—"}
                        </span>
                      </td>
                    );
                  })}
                  <td className={`${isExpanded ? "" : "rounded-r-lg"} px-2 py-2 text-center text-xl font-bold`}>
                    {fmtTotal(totalFor(t.id))}
                  </td>
                </tr>
                {isExpanded && (
                  <tr
                    className={
                      variant === "public" ? "bg-slate-800/40" : "bg-slate-50"
                    }
                  >
                    <td className="rounded-b-lg px-3 pb-3 pt-1" colSpan={data.activities.length + 4}>
                      <TeamScoreBreakdown data={data} teamId={t.id} variant={variant} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
