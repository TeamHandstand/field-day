"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { explainActivity } from "@/lib/explain";

type Activity = {
  id: string;
  name: string;
  aggregationRule: "single" | "sum_of_ranks";
  subActivities: {
    id: string;
    name: string;
    inputRule: "single_value" | "sum_of_pct_deviation" | "abs_deviation_from_target";
    sortDirection: "asc" | "desc";
    inputFields: { id: string; label: string; unit: string; targetValue: number | null }[];
  }[];
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
  inputs: { inputFieldId: string; rawValue: number }[];
};

export default function ScoreLogPage({ params }: { params: { id: string; aid: string } }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<Record<string, ScoreEntry[]>>({});
  const [openTeam, setOpenTeam] = useState<Team | null>(null);
  const [cohort, setCohort] = useState<string>("all");
  const [showExplain, setShowExplain] = useState(false);

  const load = useCallback(async () => {
    const [a, ev] = await Promise.all([
      fetch(`/api/activities/${params.aid}`).then((r) => r.json()),
      fetch(`/api/events/${params.id}/leaderboard`).then((r) => r.json()),
    ]);
    setActivity(a.activity);
    setTeams(ev.teams.map((t: { id: string; name: string; teamNumber: number; cohortNumber: number | null; photoUrl: string | null }) => ({
      id: t.id,
      name: t.name,
      teamNumber: t.teamNumber,
      cohortNumber: t.cohortNumber,
      photos: t.photoUrl ? [{ s3Url: t.photoUrl }] : [],
    })));
    const grouped: Record<string, ScoreEntry[]> = {};
    for (const s of ev.scores as { teamId: string; subActivityId: string; computedValue: number; activityId: string }[]) {
      if (s.activityId !== params.aid) continue;
      if (!grouped[s.teamId]) grouped[s.teamId] = [];
      grouped[s.teamId].push({ subActivityId: s.subActivityId, computedValue: s.computedValue, inputs: [] });
    }
    setScores(grouped);
  }, [params.aid, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!activity) return <p>Loading…</p>;

  const cohorts = Array.from(new Set(teams.map((t) => t.cohortNumber).filter((n): n is number => n != null))).sort(
    (a, b) => a - b,
  );
  const visibleTeams = teams.filter((t) => cohort === "all" || (cohort && t.cohortNumber === parseInt(cohort, 10)));

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/admin/events/${params.id}`} className="text-sm text-slate-500 hover:text-brand">
          ← Event
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{activity.name}</h1>
          <button className="text-slate-400 hover:text-brand" onClick={() => setShowExplain(true)} aria-label="Info">
            ⓘ
          </button>
        </div>
      </div>

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

      <ul className="space-y-2">
        {visibleTeams.map((t) => {
          const teamScores = scores[t.id] ?? [];
          const complete = activity.subActivities.every((s) =>
            teamScores.some((sc) => sc.subActivityId === s.id),
          );
          return (
            <li key={t.id}>
              <button
                onClick={() => setOpenTeam(t)}
                className="card flex w-full items-center justify-between text-left hover:border-brand"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                    {t.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.photos[0].s3Url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      `#${t.teamNumber}`
                    )}
                  </div>
                  <div>
                    <div className="font-semibold">
                      #{t.teamNumber} {t.name}
                    </div>
                    {t.cohortNumber && <div className="text-xs text-slate-500">Cohort {t.cohortNumber}</div>}
                  </div>
                </div>
                <span className={`badge ${complete ? "badge-green" : ""}`}>{complete ? "Logged" : "Not logged"}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {openTeam && (
        <ScoreEditor
          activity={activity}
          team={openTeam}
          onClose={() => {
            setOpenTeam(null);
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

function ScoreEditor({
  activity,
  team,
  onClose,
}: {
  activity: Activity;
  team: Team;
  onClose: () => void;
}) {
  const [raws, setRaws] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/events/${team.id}`); // not needed; reuse full event leaderboard later
      void r;
      // Pull existing raws via the activity scores endpoint.
      const ar = await fetch(`/api/activities/${activity.id}`);
      void ar;
      // Read the existing raw inputs by team.
      const existing = await fetch(
        `/api/teams/${team.id}/activity-scores?activityId=${activity.id}`,
      ).catch(() => null);
      if (existing && existing.ok) {
        const data = await existing.json();
        const map: Record<string, string> = {};
        for (const entry of data.entries as { inputs: { inputFieldId: string; rawValue: number }[] }[]) {
          for (const i of entry.inputs) map[i.inputFieldId] = String(i.rawValue);
        }
        setRaws(map);
      }
      setLoading(false);
    })();
  }, [activity.id, team.id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const subEntries = activity.subActivities.map((s) => {
        const r: Record<string, number> = {};
        for (const f of s.inputFields) {
          const v = raws[f.id];
          if (v === undefined || v === "") throw new Error(`Missing ${f.label}`);
          const num = parseFloat(v);
          if (Number.isNaN(num)) throw new Error(`Invalid number for ${f.label}`);
          r[f.id] = num;
        }
        return { subActivityId: s.id, raws: r };
      });
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, activityId: activity.id, subEntries }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Save failed");
        return;
      }
      onClose();
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
        </div>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <div className="space-y-3">
            {activity.subActivities.map((s) => (
              <div key={s.id} className="rounded-md border border-slate-200 p-3">
                <div className="font-medium">{s.name}</div>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {s.inputFields.map((f) => (
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
                        onChange={(e) => setRaws((r) => ({ ...r, [f.id]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-slate-200 bg-white px-4 pt-3">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
