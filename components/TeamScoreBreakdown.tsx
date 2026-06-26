"use client";
import type { LeaderboardData } from "@/lib/leaderboard";
import { formatMeasure, deviationToneClass, type DeviationTone } from "@/lib/format";

// Inline drill-down for a single team: what they actually scored on every
// activity, broken down to each sub-activity's input field. Where a field carries
// a target, the target and the team's signed deviation from it are shown so the
// host can see how close each team came (e.g. Gut Check estimation tasks).

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

type Props = {
  data: LeaderboardData;
  teamId: string;
  variant?: "admin" | "public";
};

export function TeamScoreBreakdown({ data, teamId, variant = "admin" }: Props) {
  const isFinalized = data.event.isFinalized && !!data.finalized;
  const dark = variant === "public";

  const scoreFor = (subActivityId: string) =>
    data.scores.find((s) => s.subActivityId === subActivityId && s.teamId === teamId);

  const activityRankFor = (activityId: string): number | undefined => {
    if (isFinalized) {
      return data.finalized!.activities.find((a) => a.activityId === activityId)?.activityRanks[
        teamId
      ];
    }
    return data.liveActivityRanks[activityId]?.[teamId];
  };
  const activityPointsFor = (activityId: string): number | undefined =>
    isFinalized
      ? data.finalized!.activities.find((a) => a.activityId === activityId)?.points[teamId]
      : undefined;

  if (data.activities.length === 0) {
    return <p className={dark ? "text-sm text-slate-400" : "text-sm text-slate-500"}>No activities yet.</p>;
  }

  return (
    <div className="space-y-3">
      {data.activities.map((a) => {
        const rank = activityRankFor(a.id);
        const points = activityPointsFor(a.id);
        return (
          <div
            key={a.id}
            className={
              dark
                ? "rounded-md border border-slate-700 bg-slate-900/60 p-3"
                : "rounded-md border border-slate-200 bg-slate-50 p-3"
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{a.name}</span>
              <div className="flex items-center gap-2 text-xs">
                {isFinalized && points != null && (
                  <span className="badge badge-blue">{points} pts</span>
                )}
                {rank != null && (
                  <span className={dark ? "text-slate-300" : "text-slate-600"}>
                    {ordinal(Math.round(rank))}
                  </span>
                )}
              </div>
            </div>

            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className={dark ? "text-slate-400" : "text-slate-500"}>
                  <th className="py-1 pr-2 text-left font-medium">Sub-activity</th>
                  <th className="py-1 pr-2 text-right font-medium">Recorded</th>
                  <th className="py-1 pr-2 text-right font-medium">Target</th>
                  <th className="py-1 pr-2 text-right font-medium">Deviation</th>
                  <th className="w-12 py-1 text-right font-medium">Rank</th>
                </tr>
              </thead>
              <tbody>
                {a.subActivities.map((s) => {
                  const score = scoreFor(s.id);
                  const rawByField = new Map(
                    (score?.inputs ?? []).map((i) => [i.inputFieldId, i.rawValue]),
                  );
                  const subRank = data.liveSubActivityRanks[s.id]?.[teamId];
                  const fields = s.inputFields.length > 0 ? s.inputFields : [];
                  const multi = fields.length > 1;

                  return (
                    <tr key={s.id} className={dark ? "border-t border-slate-700" : "border-t border-slate-200"}>
                      <td className={`py-1 pr-2 align-top ${dark ? "text-slate-300" : "text-slate-600"}`}>
                        {s.name}
                      </td>
                      <td className="py-1 pr-2 text-right align-top font-medium">
                        {fields.length === 0 ? (
                          score ? formatMeasure(score.computedValue) : "—"
                        ) : (
                          <div className="space-y-0.5">
                            {fields.map((f) => {
                              const raw = rawByField.get(f.id);
                              return (
                                <div key={f.id}>
                                  {multi && (
                                    <span className={`mr-1 text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
                                      {f.label}:
                                    </span>
                                  )}
                                  {raw != null ? (
                                    <>
                                      {formatMeasure(raw, f.unit)}
                                      {f.unit ? (
                                        <span className={`ml-1 text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
                                          {f.unit}
                                        </span>
                                      ) : null}
                                    </>
                                  ) : (
                                    "—"
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className={`py-1 pr-2 text-right align-top ${dark ? "text-slate-400" : "text-slate-500"}`}>
                        {fields.length === 0 ? (
                          "—"
                        ) : (
                          <div className="space-y-0.5">
                            {fields.map((f) => (
                              <div key={f.id}>
                                {f.targetValue != null ? formatMeasure(f.targetValue, f.unit) : "—"}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-1 pr-2 text-right align-top font-medium">
                        {fields.length === 0 ? (
                          "—"
                        ) : (
                          <div className="space-y-0.5">
                            {fields.map((f) => {
                              const raw = rawByField.get(f.id);
                              if (raw == null || f.targetValue == null) {
                                return (
                                  <div key={f.id} className={dark ? "text-slate-500" : "text-slate-400"}>
                                    —
                                  </div>
                                );
                              }
                              const diff = raw - f.targetValue;
                              const tone: DeviationTone = diff > 0 ? "over" : diff < 0 ? "under" : "on";
                              const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
                              return (
                                <div key={f.id} className={deviationToneClass(tone)}>
                                  {sign}
                                  {formatMeasure(Math.abs(diff), f.unit)}
                                  {f.unit ? <span className="ml-1 text-xs opacity-75">{f.unit}</span> : null}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className={`py-1 text-right align-top text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
                        {subRank != null ? ordinal(Math.round(subRank)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
