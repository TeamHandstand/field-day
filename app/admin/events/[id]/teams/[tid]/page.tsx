"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { LeaderboardData } from "@/lib/leaderboard";

type RosterUser = { id: string; firstName: string; lastName: string };

type Team = {
  id: string;
  name: string;
  teamNumber: number;
  cohortNumber: number | null;
  photos: { id: string; s3Url: string; s3Key: string; displayOrder: number }[];
  rosterUsers: RosterUser[];
};

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
}

export default function TeamDetail({ params }: { params: { id: string; tid: string } }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [board, setBoard] = useState<LeaderboardData | null>(null);
  const [name, setName] = useState("");
  const [number, setNumber] = useState<number>(1);
  const [cohort, setCohort] = useState<string>("");
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [editingRosterId, setEditingRosterId] = useState<string | null>(null);
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [rosterError, setRosterError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const [tRes, bRes] = await Promise.all([
      fetch(`/api/teams/${params.tid}`),
      fetch(`/api/events/${params.id}/leaderboard`),
    ]);
    if (tRes.ok) {
      const t = (await tRes.json()).team as Team;
      setTeam(t);
      setName(t.name);
      setNumber(t.teamNumber);
      setCohort(t.cohortNumber ? String(t.cohortNumber) : "");
    }
    if (bRes.ok) {
      setBoard(await bRes.json());
    }
  }, [params.id, params.tid]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    await fetch(`/api/teams/${params.tid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        teamNumber: number,
        cohortNumber: cohort ? parseInt(cohort, 10) : null,
      }),
    });
    load();
  };

  const addRoster = async (e: React.FormEvent) => {
    e.preventDefault();
    setRosterError(null);
    const f = newFirst.trim();
    const l = newLast.trim();
    if (!f || !l) {
      setRosterError("First and last name are both required.");
      return;
    }
    const res = await fetch(`/api/teams/${params.tid}/roster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: f, lastName: l }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRosterError(data.error ?? "Add failed");
      return;
    }
    setNewFirst("");
    setNewLast("");
    load();
  };

  const startEditRoster = (u: RosterUser) => {
    setEditingRosterId(u.id);
    setEditFirst(u.firstName);
    setEditLast(u.lastName);
    setRosterError(null);
  };

  const cancelEditRoster = () => {
    setEditingRosterId(null);
    setEditFirst("");
    setEditLast("");
    setRosterError(null);
  };

  const saveEditRoster = async () => {
    setRosterError(null);
    const f = editFirst.trim();
    const l = editLast.trim();
    if (!f || !l) {
      setRosterError("First and last name are both required.");
      return;
    }
    const res = await fetch(`/api/roster/${editingRosterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: f, lastName: l }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRosterError(data.error ?? "Save failed");
      return;
    }
    cancelEditRoster();
    load();
  };

  const removeRoster = async (id: string) => {
    await fetch(`/api/roster/${id}`, { method: "DELETE" });
    load();
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const contentType = file.type || "image/jpeg";
      const signRes = await fetch(`/api/teams/${params.tid}/photos/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType }),
      });
      if (!signRes.ok) {
        alert("S3 not configured or unsupported file type. Check AWS_* env vars.");
        return;
      }
      const sign = (await signRes.json()) as {
        uploadUrl: string;
        key: string;
        publicUrl: string;
        contentType: string;
      };
      const upRes = await fetch(sign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": sign.contentType },
        body: file,
      });
      if (!upRes.ok) {
        alert("S3 upload failed");
        return;
      }
      await fetch(`/api/teams/${params.tid}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s3Url: sign.publicUrl, s3Key: sign.key }),
      });
      load();
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (id: string) => {
    if (!confirm("Delete this photo?")) return;
    await fetch(`/api/photos/${id}`, { method: "DELETE" });
    load();
  };

  const movePhoto = async (id: string, dir: -1 | 1) => {
    if (!team) return;
    const ordered = [...team.photos];
    const idx = ordered.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= ordered.length) return;
    [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
    await fetch(`/api/teams/${params.tid}/photos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: ordered.map((p) => p.id) }),
    });
    load();
  };

  // Per-activity status & results for this team. An activity is "completed" only
  // when every sub-activity has a score for this team — partial logs surface
  // separately so the host can see what's still outstanding.
  const activityRows = useMemo(() => {
    if (!team || !board) return [];
    return board.activities.map((a) => {
      const subs = a.subActivities.map((s) => {
        const score = board.scores.find(
          (sc) => sc.activityId === a.id && sc.subActivityId === s.id && sc.teamId === team.id,
        );
        return {
          sub: s,
          computed: score?.computedValue ?? null,
          rank: board.liveSubActivityRanks[s.id]?.[team.id] ?? null,
        };
      });
      const allLogged = subs.every((s) => s.computed != null);
      const someLogged = subs.some((s) => s.computed != null);
      const finA = board.finalized?.activities.find((fa) => fa.activityId === a.id);
      return {
        activity: a,
        subs,
        allLogged,
        someLogged,
        activityRank: board.liveActivityRanks[a.id]?.[team.id] ?? null,
        finalRank: finA?.activityRanks[team.id] ?? null,
        finalPoints: finA?.points[team.id] ?? null,
      };
    });
  }, [team, board]);

  const completed = activityRows.filter((r) => r.allLogged);
  const inProgress = activityRows.filter((r) => !r.allLogged && r.someLogged);
  const notStarted = activityRows.filter((r) => !r.someLogged);
  const isFinalized = !!board?.event.isFinalized && !!board?.finalized;

  if (!team) return <p>Loading…</p>;

  return (
    <div className="space-y-6">
      <Link href={`/admin/events/${params.id}/teams`} className="text-sm text-slate-500 hover:text-brand">
        ← Teams
      </Link>

      <header className="flex items-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-lg font-bold text-slate-600">
          {team.photos[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={team.photos[0].s3Url} alt="" className="h-full w-full object-cover" />
          ) : (
            `#${team.teamNumber}`
          )}
        </div>
        <div>
          <h1 className="text-2xl font-bold">
            #{team.teamNumber} {team.name}
          </h1>
          <p className="text-sm text-slate-500">
            {team.cohortNumber ? `Cohort ${team.cohortNumber}` : "No cohort"}
          </p>
        </div>
      </header>

      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Activity results</h2>
          {board && (
            <div className="text-xs text-slate-500">
              {completed.length}/{board.activities.length} complete
              {inProgress.length > 0 ? ` · ${inProgress.length} partial` : ""}
            </div>
          )}
        </div>

        {board && board.activities.length === 0 && (
          <p className="text-sm text-slate-500">This event has no activities yet.</p>
        )}

        {completed.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Completed
            </h3>
            <ul className="space-y-2">
              {completed.map((row) => (
                <li key={row.activity.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/admin/events/${params.id}/activities/${row.activity.id}/log`}
                      className="font-semibold hover:text-brand"
                    >
                      {row.activity.name}
                    </Link>
                    <div className="flex items-center gap-2">
                      {isFinalized && row.finalPoints != null && (
                        <span className="badge badge-blue">{row.finalPoints} pts</span>
                      )}
                      {(isFinalized ? row.finalRank : row.activityRank) != null && (
                        <span className="badge badge-green">
                          {ordinal(
                            Math.round(
                              (isFinalized ? row.finalRank : row.activityRank) as number,
                            ),
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  <table className="mt-2 w-full text-sm">
                    <tbody>
                      {row.subs.map(({ sub, computed, rank }) => (
                        <tr key={sub.id} className="border-t border-slate-100">
                          <td className="py-1 pr-2 text-slate-600">{sub.name}</td>
                          <td className="py-1 pr-2 text-right font-medium">
                            {computed != null ? fmt(computed) : "—"}
                            {sub.inputFields[0]?.unit && (
                              <span className="ml-1 text-xs text-slate-500">
                                {sub.inputFields[0].unit}
                              </span>
                            )}
                          </td>
                          <td className="w-16 py-1 text-right text-xs text-slate-500">
                            {rank != null ? ordinal(Math.round(rank)) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </li>
              ))}
            </ul>
          </div>
        )}

        {inProgress.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Partially logged
            </h3>
            <ul className="space-y-2">
              {inProgress.map((row) => {
                const missing = row.subs.filter((s) => s.computed == null);
                return (
                  <li
                    key={row.activity.id}
                    className="rounded-md border border-amber-200 bg-amber-50 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/admin/events/${params.id}/activities/${row.activity.id}/log`}
                        className="font-semibold hover:text-brand"
                      >
                        {row.activity.name}
                      </Link>
                      <span className="text-xs text-amber-800">
                        Missing {missing.length} of {row.subs.length}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-amber-800">
                      Awaiting: {missing.map((m) => m.sub.name).join(", ")}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {notStarted.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Not started
            </h3>
            <ul className="flex flex-wrap gap-2">
              {notStarted.map((row) => (
                <li key={row.activity.id}>
                  <Link
                    href={`/admin/events/${params.id}/activities/${row.activity.id}/log`}
                    className="badge hover:border-brand"
                  >
                    {row.activity.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Team details</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Team number</label>
            <input
              className="input"
              type="number"
              value={number}
              onChange={(e) => setNumber(parseInt(e.target.value, 10))}
            />
          </div>
          <div>
            <label className="label">Cohort</label>
            <input
              className="input"
              type="number"
              value={cohort}
              onChange={(e) => setCohort(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        <button className="btn btn-primary" onClick={save}>Save</button>
      </section>

      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Photos</h2>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadPhoto(f);
                e.currentTarget.value = "";
              }}
            />
            <button className="btn btn-primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? "Uploading…" : "Upload photo"}
            </button>
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {team.photos.map((p, i) => (
            <li key={p.id} className="rounded-md border border-slate-200 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.s3Url} alt="" className="aspect-square w-full rounded object-cover" />
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-slate-500">{i === 0 ? "Primary" : `#${i + 1}`}</span>
                <div className="flex gap-1">
                  <button onClick={() => movePhoto(p.id, -1)} className="btn-ghost px-1 text-slate-500">↑</button>
                  <button onClick={() => movePhoto(p.id, 1)} className="btn-ghost px-1 text-slate-500">↓</button>
                  <button onClick={() => removePhoto(p.id)} className="text-red-600">×</button>
                </div>
              </div>
            </li>
          ))}
          {team.photos.length === 0 && <p className="text-slate-500">No photos yet.</p>}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Roster</h2>
        <form onSubmit={addRoster} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className="input"
            placeholder="First name"
            value={newFirst}
            onChange={(e) => setNewFirst(e.target.value)}
          />
          <input
            className="input"
            placeholder="Last name"
            value={newLast}
            onChange={(e) => setNewLast(e.target.value)}
          />
          <button className="btn btn-primary">Add</button>
        </form>
        {rosterError && <p className="text-sm text-red-600">{rosterError}</p>}
        <ul className="divide-y divide-slate-200">
          {team.rosterUsers.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 py-2">
              {editingRosterId === u.id ? (
                <>
                  <div className="flex flex-1 gap-2">
                    <input
                      className="input"
                      placeholder="First name"
                      value={editFirst}
                      onChange={(e) => setEditFirst(e.target.value)}
                    />
                    <input
                      className="input"
                      placeholder="Last name"
                      value={editLast}
                      onChange={(e) => setEditLast(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-1">
                    <button onClick={saveEditRoster} className="btn btn-primary text-sm">
                      Save
                    </button>
                    <button onClick={cancelEditRoster} className="btn btn-ghost text-sm">
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span>
                    {u.firstName} {u.lastName}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEditRoster(u)}
                      className="text-sm text-slate-600 hover:text-brand"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removeRoster(u.id)}
                      className="text-sm text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
          {team.rosterUsers.length === 0 && <p className="text-slate-500">No roster yet.</p>}
        </ul>
      </section>
    </div>
  );
}
