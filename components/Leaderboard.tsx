"use client";
import { useCallback, useEffect, useState } from "react";
import { useEventChannel } from "@/lib/pubnub-client";
import type { LeaderboardData } from "@/lib/leaderboard";

type Props = {
  eventId: string;
  variant?: "admin" | "public";
  initialCohort?: string;
};

function fmtRank(r: number | undefined): string {
  if (r === undefined) return "—";
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
}

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

export function Leaderboard({ eventId, variant = "admin", initialCohort = "all" }: Props) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [cohort, setCohort] = useState(initialCohort);

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

  const sortedTeams = [...visibleTeams].sort((a, b) => {
    if (isFinalized) {
      const ra = finalized!.globalRanks[a.id];
      const rb = finalized!.globalRanks[b.id];
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
    }
    return a.teamNumber - b.teamNumber;
  });

  return (
    <div className={variant === "public" ? "space-y-4 text-slate-100" : "space-y-4"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={variant === "public" ? "text-3xl font-bold" : "text-xl font-semibold"}>
          {isFinalized ? "Final Results" : "Live Standings"} — {data.event.name}
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

      {!isFinalized && (
        <p className={variant === "public" ? "text-slate-300" : "text-sm text-slate-500"}>
          Final standings published when the event ends.
        </p>
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
              <th className="px-2 py-2 text-left">Rank</th>
              <th className="px-2 py-2 text-left">Team</th>
              {data.activities.map((a) => (
                <th key={a.id} className="px-2 py-2 text-center">
                  {a.name}
                </th>
              ))}
              {isFinalized && <th className="px-2 py-2 text-center font-semibold">Total</th>}
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map((t) => {
              const totalPts = isFinalized ? finalized!.totals[t.id] ?? 0 : null;
              const globalRank = isFinalized ? finalized!.globalRanks[t.id] : null;
              return (
                <tr
                  key={t.id}
                  className={
                    variant === "public"
                      ? "rounded-lg bg-slate-800/60"
                      : "rounded-lg bg-white shadow-sm"
                  }
                >
                  <td className="rounded-l-lg px-2 py-2 font-bold">
                    {globalRank != null ? ordinal(Math.round(globalRank)) : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-slate-300 text-xs font-bold text-slate-700">
                        {t.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.photoUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          `#${t.teamNumber}`
                        )}
                      </div>
                      <div>
                        <div className="font-semibold">{t.name}</div>
                        <div
                          className={
                            variant === "public" ? "text-xs text-slate-400" : "text-xs text-slate-500"
                          }
                        >
                          #{t.teamNumber}
                          {t.cohortNumber != null ? ` · Cohort ${t.cohortNumber}` : ""}
                        </div>
                      </div>
                    </div>
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
                  {isFinalized && (
                    <td className="rounded-r-lg px-2 py-2 text-center text-xl font-bold">{totalPts}</td>
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
