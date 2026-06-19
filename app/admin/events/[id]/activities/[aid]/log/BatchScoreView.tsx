"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TimeInput, shouldUseTimeInput } from "@/components/TimeInput";

type InputField = { id: string; label: string; unit: string; targetValue: number | null };
type SubActivity = {
  id: string;
  name: string;
  inputRule: "single_value" | "sum_of_pct_deviation" | "abs_deviation_from_target";
  sortDirection: "asc" | "desc";
  inputFields: InputField[];
};
type Activity = { id: string; name: string; subActivities: SubActivity[] };
type Member = { firstName: string; lastName: string };
type Team = {
  id: string;
  name: string;
  teamNumber: number;
  cohortNumber: number | null;
  photos: { s3Url: string }[];
  rosterUsers: Member[];
};

// raws[teamId][inputFieldId] = string the host typed (empty string = blank).
type RawMap = Record<string, Record<string, string>>;
// stored[teamId][inputFieldId] = the saved value as a string, for change detection.
type StoredMap = Record<string, Record<string, string>>;

function isComplete(sub: SubActivity, teamRaws: Record<string, string> | undefined): boolean {
  if (!teamRaws) return false;
  return sub.inputFields.every(
    (f) =>
      teamRaws[f.id] !== undefined &&
      teamRaws[f.id] !== "" &&
      Number.isFinite(parseFloat(teamRaws[f.id])),
  );
}

function isPartial(sub: SubActivity, teamRaws: Record<string, string> | undefined): boolean {
  if (!teamRaws) return false;
  const filled = sub.inputFields.filter(
    (f) => teamRaws[f.id] !== undefined && teamRaws[f.id] !== "",
  );
  return filled.length > 0 && filled.length < sub.inputFields.length;
}

function isChanged(
  sub: SubActivity,
  teamRaws: Record<string, string> | undefined,
  stored: Record<string, string> | undefined,
): boolean {
  if (!teamRaws) return false;
  return sub.inputFields.some((f) => (teamRaws[f.id] ?? "") !== (stored?.[f.id] ?? ""));
}

export default function BatchScoreView({
  eventId,
  activityId,
}: {
  eventId: string;
  activityId: string;
}) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [raws, setRaws] = useState<RawMap>({});
  const [stored, setStored] = useState<StoredMap>({});
  const [subId, setSubId] = useState<string>("");
  const [cohort, setCohort] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, t] = await Promise.all([
      fetch(`/api/activities/${activityId}`).then((r) => r.json()),
      fetch(`/api/events/${eventId}/teams`).then((r) => r.json()),
    ]);
    const act: Activity = a.activity;
    setActivity(act);
    setSubId((prev) => prev || act.subActivities[0]?.id || "");
    const teamList: Team[] = t.teams;
    setTeams(teamList);

    // Fetch existing scores for every team so inputs prefill.
    const scoreLists = await Promise.all(
      teamList.map((tm) =>
        fetch(`/api/teams/${tm.id}/activity-scores?activityId=${activityId}`)
          .then((r) => r.json())
          .then((d) => ({
            teamId: tm.id,
            entries: d.entries as {
              subActivityId: string;
              inputs: { inputFieldId: string; rawValue: number }[];
            }[],
          }))
          .catch(() => ({ teamId: tm.id, entries: [] })),
      ),
    );
    const nextRaws: RawMap = {};
    const nextStored: StoredMap = {};
    for (const { teamId, entries } of scoreLists) {
      nextRaws[teamId] = {};
      nextStored[teamId] = {};
      for (const e of entries) {
        for (const i of e.inputs) {
          nextRaws[teamId][i.inputFieldId] = String(i.rawValue);
          nextStored[teamId][i.inputFieldId] = String(i.rawValue);
        }
      }
    }
    setRaws(nextRaws);
    setStored(nextStored);
    setLoading(false);
  }, [activityId, eventId]);

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

  const sub = activity?.subActivities.find((s) => s.id === subId) ?? null;

  const visibleTeams = useMemo(
    () =>
      (cohort === "all"
        ? teams
        : teams.filter((t) => t.cohortNumber === parseInt(cohort, 10))
      ).sort((a, b) => a.teamNumber - b.teamNumber),
    [teams, cohort],
  );

  // Count, for each sub-activity pill, how many visible teams have a stored value.
  const loggedCount = useCallback(
    (s: SubActivity) =>
      visibleTeams.filter((t) =>
        s.inputFields.every((f) => stored[t.id]?.[f.id] !== undefined),
      ).length,
    [visibleTeams, stored],
  );

  const setRaw = (teamId: string, fieldId: string, value: string) => {
    setRaws((prev) => ({ ...prev, [teamId]: { ...prev[teamId], [fieldId]: value } }));
    setSavedMsg(null);
  };

  const dirtyTeamIds = useMemo(() => {
    if (!sub) return [] as string[];
    return visibleTeams
      .filter((t) => isComplete(sub, raws[t.id]) && isChanged(sub, raws[t.id], stored[t.id]))
      .map((t) => t.id);
  }, [sub, visibleTeams, raws, stored]);

  const partialCount = useMemo(
    () => (sub ? visibleTeams.filter((t) => isPartial(sub, raws[t.id])).length : 0),
    [sub, visibleTeams, raws],
  );

  const guardedSwitch = (fn: () => void) => {
    if (dirtyTeamIds.length > 0) {
      if (!window.confirm("You have unsaved values. Discard them and switch?")) return;
    }
    fn();
  };

  const save = async () => {
    if (!sub) return;
    setSaving(true);
    setError(null);
    try {
      const payloadTeams = dirtyTeamIds.map((teamId) => {
        const r: Record<string, number> = {};
        for (const f of sub.inputFields) r[f.id] = parseFloat(raws[teamId][f.id]);
        return { teamId, raws: r };
      });
      if (payloadTeams.length === 0) {
        setError("No complete, changed rows to save.");
        return;
      }
      const res = await fetch("/api/scores/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId, subActivityId: sub.id, teams: payloadTeams }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Save failed");
        return;
      }
      setSavedMsg(
        `Saved ${payloadTeams.length} team${payloadTeams.length === 1 ? "" : "s"} for ${sub.name}.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !activity) return <p>Loading…</p>;

  return (
    <div className="space-y-4 pb-24">
      {/* Sub-activity picker */}
      <div className="flex flex-wrap gap-2">
        {activity.subActivities.map((s) => (
          <button
            key={s.id}
            onClick={() => guardedSwitch(() => setSubId(s.id))}
            className={`btn text-sm ${s.id === subId ? "btn-primary" : "btn-secondary"}`}
          >
            {s.name}{" "}
            <span className="ml-1 text-xs opacity-70">
              {loggedCount(s)}/{visibleTeams.length}
            </span>
          </button>
        ))}
      </div>

      {/* Cohort filter */}
      {cohorts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            className={`btn text-sm ${cohort === "all" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => guardedSwitch(() => setCohort("all"))}
          >
            All
          </button>
          {cohorts.map((c) => (
            <button
              key={c}
              className={`btn text-sm ${cohort === String(c) ? "btn-primary" : "btn-secondary"}`}
              onClick={() => guardedSwitch(() => setCohort(String(c)))}
            >
              Cohort {c}
            </button>
          ))}
        </div>
      )}

      {savedMsg && (
        <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          <strong>Saved.</strong> {savedMsg}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Team rows */}
      {sub && (
        <ul className="space-y-2">
          {visibleTeams.map((t) => {
            const teamRaws = raws[t.id];
            const complete = isComplete(sub, teamRaws);
            const partial = isPartial(sub, teamRaws);
            const changed = isChanged(sub, teamRaws, stored[t.id]);
            const useTime =
              sub.inputFields.length === 1 &&
              shouldUseTimeInput(sub.inputRule, sub.inputFields[0].unit);
            return (
              <li
                key={t.id}
                className="card flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                    {t.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.photos[0].s3Url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      `T${t.teamNumber}`
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold">
                      T{t.teamNumber} {t.name}
                      {complete && changed && <span className="badge badge-blue ml-2">Edited</span>}
                      {complete && !changed && (
                        <span className="badge badge-green ml-2">Saved</span>
                      )}
                      {partial && <span className="badge badge-amber ml-2">Incomplete</span>}
                    </div>
                    {t.rosterUsers.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
                        {t.rosterUsers.map((m, i) => (
                          <span key={i}>
                            {m.firstName} {m.lastName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {useTime ? (
                    <div className="w-40">
                      <label className="label text-xs">
                        {sub.inputFields[0].label}{" "}
                        <span className="text-slate-500">(min : sec)</span>
                      </label>
                      <TimeInput
                        value={teamRaws?.[sub.inputFields[0].id] ?? ""}
                        onChange={(v) => setRaw(t.id, sub.inputFields[0].id, v)}
                      />
                    </div>
                  ) : (
                    sub.inputFields.map((f) => (
                      <div key={f.id} className="w-28">
                        <label className="label text-xs">
                          {f.label}{" "}
                          <span className="text-slate-500">
                            ({f.unit}
                            {f.targetValue != null ? `, t${f.targetValue}` : ""})
                          </span>
                        </label>
                        <input
                          className="input"
                          type="number"
                          inputMode="decimal"
                          step="any"
                          value={teamRaws?.[f.id] ?? ""}
                          onChange={(e) => setRaw(t.id, f.id, e.target.value)}
                        />
                      </div>
                    ))
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {partialCount > 0
              ? `${partialCount} row${partialCount === 1 ? "" : "s"} partially filled — complete or clear to save.`
              : `${dirtyTeamIds.length} change${dirtyTeamIds.length === 1 ? "" : "s"} ready.`}
          </p>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || dirtyTeamIds.length === 0 || partialCount > 0}
          >
            {saving
              ? "Saving…"
              : `Save ${dirtyTeamIds.length} change${dirtyTeamIds.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
