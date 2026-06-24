"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  // Per-team auto-save status, so each row can show its own "Saving…"/error state
  // without a global spinner or a full reload of the grid.
  const [savingTeams, setSavingTeams] = useState<Record<string, boolean>>({});
  const [teamErrors, setTeamErrors] = useState<Record<string, string>>({});
  // Guards against firing a second POST for a team while its save is in flight.
  const inFlight = useRef<Record<string, boolean>>({});

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
    // A fresh edit supersedes any prior failed save for this team.
    setTeamErrors((prev) => {
      if (!(teamId in prev)) return prev;
      const next = { ...prev };
      delete next[teamId];
      return next;
    });
  };

  // Mark the given sub-activity's fields for a set of teams as persisted, copying
  // the raw values into `stored`. This is how a save "sticks" without re-fetching
  // the whole grid — `stored` drives the Saved/Edited badges and the pill counts.
  const commitStored = useCallback(
    (s: SubActivity, snapshots: Record<string, Record<string, string>>) => {
      setStored((prev) => {
        const next = { ...prev };
        for (const [teamId, snap] of Object.entries(snapshots)) {
          next[teamId] = { ...next[teamId] };
          for (const f of s.inputFields) {
            if (snap[f.id] !== undefined) next[teamId][f.id] = snap[f.id];
          }
        }
        return next;
      });
    },
    [],
  );

  // Auto-save a single team's row when it loses focus, provided the row is fully
  // filled and actually changed. Updates only that team's `stored` on success so
  // the rest of the page never reloads or loses in-progress edits elsewhere.
  const saveTeam = useCallback(
    async (teamId: string) => {
      if (!sub) return;
      const teamRaws = raws[teamId];
      if (!isComplete(sub, teamRaws) || !isChanged(sub, teamRaws, stored[teamId])) return;
      if (inFlight.current[teamId]) return;
      inFlight.current[teamId] = true;
      setSavingTeams((prev) => ({ ...prev, [teamId]: true }));

      // Snapshot exactly what we send so `stored` matches the persisted values even
      // if the host keeps typing in another row while this request is in flight.
      const snapshot: Record<string, string> = {};
      const r: Record<string, number> = {};
      for (const f of sub.inputFields) {
        snapshot[f.id] = teamRaws![f.id];
        r[f.id] = parseFloat(teamRaws![f.id]);
      }
      try {
        const res = await fetch("/api/scores/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activityId, subActivityId: sub.id, teams: [{ teamId, raws: r }] }),
        });
        if (!res.ok) {
          const msg = (await res.json().catch(() => ({}))).error ?? "Save failed";
          setTeamErrors((prev) => ({ ...prev, [teamId]: msg }));
          return;
        }
        setTeamErrors((prev) => {
          if (!(teamId in prev)) return prev;
          const next = { ...prev };
          delete next[teamId];
          return next;
        });
        commitStored(sub, { [teamId]: snapshot });
      } catch (e) {
        setTeamErrors((prev) => ({
          ...prev,
          [teamId]: e instanceof Error ? e.message : "Save failed",
        }));
      } finally {
        inFlight.current[teamId] = false;
        setSavingTeams((prev) => {
          const next = { ...prev };
          delete next[teamId];
          return next;
        });
      }
    },
    [sub, raws, stored, activityId, commitStored],
  );

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

  const savingCount = Object.values(savingTeams).filter(Boolean).length;
  const errorCount = Object.keys(teamErrors).length;

  const guardedSwitch = (fn: () => void) => {
    // Edited rows auto-save on blur, so a lingering dirty row here means a save is
    // still pending or failed — warn before navigating away from it.
    if (dirtyTeamIds.length > 0 || errorCount > 0) {
      if (!window.confirm("Some rows haven’t saved yet. Switch anyway?")) return;
    }
    fn();
  };

  const save = async () => {
    if (!sub) return;
    setSaving(true);
    setError(null);
    try {
      const snapshots: Record<string, Record<string, string>> = {};
      const payloadTeams = dirtyTeamIds.map((teamId) => {
        const r: Record<string, number> = {};
        const snap: Record<string, string> = {};
        for (const f of sub.inputFields) {
          r[f.id] = parseFloat(raws[teamId][f.id]);
          snap[f.id] = raws[teamId][f.id];
        }
        snapshots[teamId] = snap;
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
      // Update only the just-saved rows in place instead of refetching the whole
      // grid, so the page doesn't flash/reload and unrelated edits are preserved.
      commitStored(sub, snapshots);
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
            const isSaving = savingTeams[t.id];
            const teamError = teamErrors[t.id];
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
                      {isSaving ? (
                        <span className="badge badge-blue ml-2">Saving…</span>
                      ) : teamError ? (
                        <span className="badge badge-red ml-2">Not saved</span>
                      ) : (
                        <>
                          {complete && changed && (
                            <span className="badge badge-amber ml-2">Unsaved</span>
                          )}
                          {complete && !changed && (
                            <span className="badge badge-green ml-2">Saved</span>
                          )}
                          {partial && <span className="badge badge-amber ml-2">Incomplete</span>}
                        </>
                      )}
                    </div>
                    {teamError && (
                      <div className="mt-0.5 text-xs font-medium text-red-600">
                        Couldn’t save: {teamError} — fix and re-enter to retry.
                      </div>
                    )}
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
                        onBlur={() => saveTeam(t.id)}
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
                          onBlur={() => saveTeam(t.id)}
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
            {errorCount > 0 ? (
              <span className="font-medium text-red-600">
                {errorCount} row{errorCount === 1 ? "" : "s"} failed to save — see highlighted
                rows.
              </span>
            ) : savingCount > 0 ? (
              "Saving…"
            ) : partialCount > 0 ? (
              `${partialCount} row${partialCount === 1 ? "" : "s"} partially filled — complete to save.`
            ) : dirtyTeamIds.length > 0 ? (
              `${dirtyTeamIds.length} edited row${dirtyTeamIds.length === 1 ? "" : "s"} — saved when you tap out of the field.`
            ) : (
              "Scores save automatically as you move between fields."
            )}
          </p>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || dirtyTeamIds.length === 0 || partialCount > 0}
          >
            {saving
              ? "Saving…"
              : dirtyTeamIds.length > 0
                ? `Save ${dirtyTeamIds.length} now`
                : "All saved"}
          </button>
        </div>
      </div>
    </div>
  );
}
