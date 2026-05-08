"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { explainActivity } from "@/lib/explain";
import { TimeInput, shouldUseTimeInput } from "@/components/TimeInput";
import { rankActivity, type ActivityShape, type SubActivityScore } from "@/lib/scoring";

type SubActivity = {
  id: string;
  name: string;
  inputRule: "single_value" | "sum_of_pct_deviation" | "abs_deviation_from_target";
  sortDirection: "asc" | "desc";
  inputFields: { id: string; label: string; unit: string; targetValue: number | null }[];
};

type Activity = {
  id: string;
  name: string;
  aggregationRule: "single" | "sum_of_ranks";
  subActivities: SubActivity[];
};

type Team = {
  id: string;
  name: string;
  teamNumber: number;
  cohortNumber: number | null;
  photos: { s3Url: string }[];
};

type ScoreEntry = {
  subActivityId: string;
  computedValue: number;
};

type SortMode = "number" | "rank";

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

function fmtNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
}

// Format a sub-activity's recorded value for the team list. Times measured in
// seconds get shown as m:ss so the host doesn't have to do the math; everything
// else just gets its unit appended.
function fmtRecordedValue(value: number, sub: SubActivity): string {
  if (shouldUseTimeInput(sub.inputRule, sub.inputFields[0]?.unit ?? "")) {
    const total = Math.abs(value);
    const sign = value < 0 ? "-" : "";
    const mins = Math.floor(total / 60);
    const secs = total - mins * 60;
    const secsStr = (Number.isInteger(secs) ? secs.toString() : secs.toFixed(2)).padStart(
      Number.isInteger(secs) ? 2 : 5,
      "0",
    );
    return `${sign}${mins}:${secsStr}`;
  }
  const unit = sub.inputFields[0]?.unit;
  return unit ? `${fmtNumber(value)} ${unit}` : fmtNumber(value);
}

export default function ScoreLogPage({ params }: { params: { id: string; aid: string } }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [eventName, setEventName] = useState<string>("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<Record<string, ScoreEntry[]>>({});
  const [openTeam, setOpenTeam] = useState<Team | null>(null);
  const [cohort, setCohort] = useState<string>("all");
  const [showExplain, setShowExplain] = useState(false);
  const [sortBy, setSortBy] = useState<SortMode>("number");
  const [savedTeamName, setSavedTeamName] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, ev] = await Promise.all([
      fetch(`/api/activities/${params.aid}`).then((r) => r.json()),
      fetch(`/api/events/${params.id}/leaderboard`).then((r) => r.json()),
    ]);
    setActivity(a.activity);
    setEventName(ev.event?.name ?? "");
    setTeams(
      ev.teams.map(
        (t: {
          id: string;
          name: string;
          teamNumber: number;
          cohortNumber: number | null;
          photoUrl: string | null;
        }) => ({
          id: t.id,
          name: t.name,
          teamNumber: t.teamNumber,
          cohortNumber: t.cohortNumber,
          photos: t.photoUrl ? [{ s3Url: t.photoUrl }] : [],
        }),
      ),
    );
    const grouped: Record<string, ScoreEntry[]> = {};
    for (const s of ev.scores as {
      teamId: string;
      subActivityId: string;
      computedValue: number;
      activityId: string;
    }[]) {
      if (s.activityId !== params.aid) continue;
      if (!grouped[s.teamId]) grouped[s.teamId] = [];
      grouped[s.teamId].push({ subActivityId: s.subActivityId, computedValue: s.computedValue });
    }
    setScores(grouped);
  }, [params.aid, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const cohorts = useMemo(
    () =>
      Array.from(
        new Set(teams.map((t) => t.cohortNumber).filter((n): n is number => n != null)),
      ).sort((a, b) => a - b),
    [teams],
  );

  // Compute per-team activity rank against the visible cohort. Recomputed whenever
  // the cohort filter changes so "rank" reflects what the host is actually looking at.
  const visibleTeams = useMemo(
    () =>
      cohort === "all"
        ? teams
        : teams.filter((t) => t.cohortNumber === parseInt(cohort, 10)),
    [teams, cohort],
  );

  const ranks = useMemo<Map<string, number>>(() => {
    if (!activity) return new Map();
    const visibleIds = new Set(visibleTeams.map((t) => t.id));
    const cohortScores: SubActivityScore[] = [];
    for (const [teamId, entries] of Object.entries(scores)) {
      if (!visibleIds.has(teamId)) continue;
      for (const e of entries) {
        cohortScores.push({
          subActivityId: e.subActivityId,
          teamId,
          computedValue: e.computedValue,
        });
      }
    }
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
    const r = rankActivity(shape, cohortScores, visibleTeams.map((t) => t.id));
    return r.ranks;
  }, [activity, visibleTeams, scores]);

  if (!activity) return <p>Loading…</p>;

  const totalSubs = activity.subActivities.length;

  const sortedTeams = [...visibleTeams].sort((a, b) => {
    if (sortBy === "rank") {
      const ra = ranks.get(a.id);
      const rb = ranks.get(b.id);
      if (ra == null && rb == null) return a.teamNumber - b.teamNumber;
      if (ra == null) return 1;
      if (rb == null) return -1;
      if (ra !== rb) return ra - rb;
    }
    return a.teamNumber - b.teamNumber;
  });

  const cohortLabel = cohort === "all" ? "all teams" : `cohort ${cohort}`;

  return (
    <div className="space-y-4">
      {/* Sticky context bar — pinned just below the admin nav so the host always
          knows which event + activity they're logging into. */}
      <div className="sticky top-[3.5rem] z-20 -mx-4 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur">
        <Link
          href={`/admin/events/${params.id}`}
          className="text-xs text-slate-500 hover:text-brand"
        >
          ← {eventName || "Event"}
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold leading-tight">{activity.name}</h1>
          <button
            className="text-slate-400 hover:text-brand"
            onClick={() => setShowExplain(true)}
            aria-label="Info"
          >
            ⓘ
          </button>
        </div>
      </div>

      {savedTeamName && (
        <div className="flex items-center justify-between rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          <span>
            <strong>Saved</strong> {savedTeamName}&apos;s score for {activity.name}.
          </span>
          <button
            className="text-green-700 hover:text-green-900"
            onClick={() => setSavedTeamName(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {cohorts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            className={`btn ${cohort === "all" ? "btn-primary" : "btn-secondary"} text-sm`}
            onClick={() => setCohort("all")}
          >
            All
          </button>
          {cohorts.map((c) => (
            <button
              key={c}
              className={`btn ${cohort === String(c) ? "btn-primary" : "btn-secondary"} text-sm`}
              onClick={() => setCohort(String(c))}
            >
              Cohort {c}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          <button
            onClick={() => setSortBy("number")}
            className={`rounded px-3 py-1 ${
              sortBy === "number" ? "bg-brand text-white" : "text-slate-600 hover:text-brand"
            }`}
          >
            Sort by team #
          </button>
          <button
            onClick={() => setSortBy("rank")}
            className={`rounded px-3 py-1 ${
              sortBy === "rank" ? "bg-brand text-white" : "text-slate-600 hover:text-brand"
            }`}
          >
            Sort by rank
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {sortBy === "rank"
            ? `Ranked against ${cohortLabel}. Teams with incomplete scores appear last.`
            : `Listed by team number across ${cohortLabel}.`}
        </p>
      </div>

      <ul className="space-y-2">
        {sortedTeams.map((t) => {
          const teamScores = scores[t.id] ?? [];
          const loggedCount = activity.subActivities.filter((s) =>
            teamScores.some((sc) => sc.subActivityId === s.id),
          ).length;
          let badgeText: string;
          let badgeClass: string;
          if (loggedCount === 0) {
            badgeText = "Not logged";
            badgeClass = "";
          } else if (loggedCount < totalSubs) {
            badgeText = `${loggedCount} / ${totalSubs}`;
            badgeClass = "badge-amber";
          } else if (totalSubs === 1) {
            badgeText = "Logged";
            badgeClass = "badge-green";
          } else {
            badgeText = `${loggedCount} / ${totalSubs}`;
            badgeClass = "badge-green";
          }
          const rank = ranks.get(t.id);
          const valueParts = activity.subActivities.map((s) => {
            const sc = teamScores.find((x) => x.subActivityId === s.id);
            return {
              subId: s.id,
              subName: s.name,
              text: sc ? fmtRecordedValue(sc.computedValue, s) : null,
            };
          });
          const hasAnyValue = valueParts.some((v) => v.text != null);
          return (
            <li key={t.id}>
              <button
                onClick={() => setOpenTeam(t)}
                className="card flex w-full items-center justify-between gap-3 text-left hover:border-brand"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {sortBy === "rank" && (
                    <div className="w-10 text-center text-lg font-bold text-slate-700">
                      {rank != null ? ordinal(Math.round(rank)) : "—"}
                    </div>
                  )}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                    {t.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.photos[0].s3Url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      `#${t.teamNumber}`
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold">
                      #{t.teamNumber} {t.name}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                      {t.cohortNumber && <span>Cohort {t.cohortNumber}</span>}
                      {hasAnyValue ? (
                        totalSubs === 1 ? (
                          <span className="font-medium text-slate-700">
                            {valueParts[0].text ?? "—"}
                          </span>
                        ) : (
                          valueParts.map((v) => (
                            <span key={v.subId} className="text-slate-600">
                              <span className="text-slate-400">{v.subName}:</span>{" "}
                              <span className="font-medium text-slate-700">
                                {v.text ?? "—"}
                              </span>
                            </span>
                          ))
                        )
                      ) : null}
                    </div>
                  </div>
                </div>
                <span className={`badge ${badgeClass} shrink-0`}>{badgeText}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {openTeam && (
        <ScoreEditor
          activity={activity}
          team={openTeam}
          onClose={() => setOpenTeam(null)}
          onSaved={(teamLabel) => {
            setSavedTeamName(teamLabel);
            load();
          }}
        />
      )}

      {showExplain && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="card max-h-[80vh] w-full max-w-md overflow-y-auto">
            <h3 className="text-lg font-semibold">How {activity.name} scores</h3>
            <p
              className="mt-2 text-sm text-slate-700"
              dangerouslySetInnerHTML={{
                __html: explainActivity(activity, teams.length).replace(
                  /\*\*(.+?)\*\*/g,
                  "<strong>$1</strong>",
                ),
              }}
            />
            <div className="mt-4 flex justify-end">
              <button className="btn btn-secondary" onClick={() => setShowExplain(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type SubStatus = "empty" | "partial" | "complete" | "saved";

function evaluateSub(sub: SubActivity, raws: Record<string, string>, savedSubIds: Set<string>): SubStatus {
  const filled = sub.inputFields.filter((f) => raws[f.id] !== undefined && raws[f.id] !== "");
  if (filled.length === 0) {
    return savedSubIds.has(sub.id) ? "saved" : "empty";
  }
  if (filled.length < sub.inputFields.length) return "partial";
  // All filled — but must be valid numbers.
  for (const f of sub.inputFields) {
    if (!Number.isFinite(parseFloat(raws[f.id]))) return "partial";
  }
  return "complete";
}

function ScoreEditor({
  activity,
  team,
  onClose,
  onSaved,
}: {
  activity: Activity;
  team: Team;
  onClose: () => void;
  onSaved: (teamLabel: string) => void;
}) {
  const [raws, setRaws] = useState<Record<string, string>>({});
  const [savedSubIds, setSavedSubIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When existing scores are found, force the host to explicitly opt in to editing
  // them so they don't accidentally overwrite a submission they thought was final.
  const [unlocked, setUnlocked] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const existing = await fetch(
        `/api/teams/${team.id}/activity-scores?activityId=${activity.id}`,
      ).catch(() => null);
      if (existing && existing.ok) {
        const data = (await existing.json()) as {
          entries: { subActivityId: string; inputs: { inputFieldId: string; rawValue: number }[] }[];
        };
        const map: Record<string, string> = {};
        const saved = new Set<string>();
        for (const entry of data.entries) {
          saved.add(entry.subActivityId);
          for (const i of entry.inputs) map[i.inputFieldId] = String(i.rawValue);
        }
        setRaws(map);
        setSavedSubIds(saved);
      }
      setLoading(false);
    })();
  }, [activity.id, team.id]);

  const subStatuses = activity.subActivities.map((s) => ({
    sub: s,
    status: evaluateSub(s, raws, savedSubIds),
  }));
  const completeCount = subStatuses.filter((x) => x.status === "complete").length;
  const partialCount = subStatuses.filter((x) => x.status === "partial").length;

  const hasAnySaved = savedSubIds.size > 0;
  const allSaved = savedSubIds.size === activity.subActivities.length;
  const isLocked = hasAnySaved && !unlocked;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const subEntries = activity.subActivities
        .filter((s) => evaluateSub(s, raws, savedSubIds) === "complete")
        .map((s) => {
          const r: Record<string, number> = {};
          for (const f of s.inputFields) r[f.id] = parseFloat(raws[f.id]);
          return { subActivityId: s.id, raws: r };
        });
      if (subEntries.length === 0) {
        setError("Fill in every input for at least one sub-activity to save.");
        return;
      }
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, activityId: activity.id, subEntries }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Save failed");
        return;
      }
      // Briefly show in-modal confirmation, then notify parent so they can show a
      // toast and refresh data.
      setJustSaved(true);
      setTimeout(() => {
        onSaved(`#${team.teamNumber} ${team.name}`);
        onClose();
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="card max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto">
        <div>
          <h3 className="text-lg font-semibold">
            #{team.teamNumber} {team.name}
          </h3>
          <p className="text-sm text-slate-500">{activity.name}</p>
          {activity.subActivities.length > 1 && (
            <p className="mt-1 text-xs text-slate-500">
              You can log sub-activities one at a time. Anything left blank stays unlogged
              and can be filled in later.
            </p>
          )}
        </div>

        {!loading && hasAnySaved && (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              unlocked
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-blue-300 bg-blue-50 text-blue-900"
            }`}
          >
            {unlocked ? (
              <div className="flex items-start justify-between gap-2">
                <span>
                  Editing existing {allSaved ? "submission" : "submissions"}. Saving will
                  overwrite the prior value.
                </span>
                <button
                  className="text-xs underline"
                  onClick={() => setUnlocked(false)}
                >
                  Re-lock
                </button>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">
                    {allSaved ? "Already submitted" : "Some scores already submitted"}
                  </div>
                  <p className="mt-0.5 text-xs">
                    Unlock the form to edit and overwrite the prior value.
                  </p>
                </div>
                <button
                  className="btn btn-secondary text-xs"
                  onClick={() => setUnlocked(true)}
                >
                  Unlock to edit
                </button>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <p>Loading…</p>
        ) : (
          <div className="space-y-3">
            {subStatuses.map(({ sub, status }) => {
              const useTime = sub.inputFields.length === 1 && shouldUseTimeInput(sub.inputRule, sub.inputFields[0].unit);
              return (
                <div key={sub.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{sub.name}</div>
                    {status === "saved" && <span className="badge badge-green">Saved</span>}
                    {status === "complete" && <span className="badge badge-blue">Will save</span>}
                    {status === "partial" && <span className="badge badge-amber">Incomplete</span>}
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {useTime ? (
                      <div>
                        <label className="label">
                          {sub.inputFields[0].label}{" "}
                          <span className="text-xs text-slate-500">(min : sec)</span>
                        </label>
                        <TimeInput
                          value={raws[sub.inputFields[0].id] ?? ""}
                          onChange={(v) =>
                            setRaws((r) => ({ ...r, [sub.inputFields[0].id]: v }))
                          }
                          disabled={isLocked}
                        />
                      </div>
                    ) : (
                      sub.inputFields.map((f) => (
                        <div key={f.id}>
                          <label className="label">
                            {f.label}{" "}
                            <span className="text-xs text-slate-500">
                              ({f.unit}
                              {f.targetValue != null ? `, target ${f.targetValue}` : ""})
                            </span>
                          </label>
                          <input
                            className="input text-lg"
                            type="number"
                            inputMode="decimal"
                            step="any"
                            value={raws[f.id] ?? ""}
                            disabled={isLocked}
                            onChange={(e) =>
                              setRaws((r) => ({ ...r, [f.id]: e.target.value }))
                            }
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {justSaved && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-800">
            ✓ Saved
          </p>
        )}
        <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-slate-200 bg-white px-4 pt-3">
          {partialCount > 0 && completeCount === 0 && (
            <p className="text-xs text-amber-700">
              Fill every input for at least one sub-activity to save.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={onClose}>
              {justSaved ? "Close" : "Cancel"}
            </button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={saving || completeCount === 0 || isLocked || justSaved}
            >
              {saving
                ? "Saving…"
                : completeCount === activity.subActivities.length
                  ? hasAnySaved
                    ? "Save changes"
                    : "Save"
                  : `Save ${completeCount} of ${activity.subActivities.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
