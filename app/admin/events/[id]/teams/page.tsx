"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Team = {
  id: string;
  name: string;
  teamNumber: number;
  cohortNumber: number | null;
  photos: { id: string; s3Url: string }[];
  rosterUsers: { id: string; name: string }[];
};

export default function TeamsPage({ params }: { params: { id: string } }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [batch, setBatch] = useState(14);
  const [start, setStart] = useState(1);
  const [single, setSingle] = useState({ name: "", teamNumber: "", cohortNumber: "" });

  const load = useCallback(async () => {
    const r = await fetch(`/api/events/${params.id}/teams`);
    if (r.ok) setTeams((await r.json()).teams);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const addBatch = async () => {
    await fetch(`/api/events/${params.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: batch, startNumber: start }),
    });
    load();
  };

  const addSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    const tn = parseInt(single.teamNumber, 10);
    if (!single.name.trim() || !Number.isFinite(tn)) return;
    await fetch(`/api/events/${params.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: single.name.trim(),
        teamNumber: tn,
        cohortNumber: single.cohortNumber ? parseInt(single.cohortNumber, 10) : null,
      }),
    });
    setSingle({ name: "", teamNumber: "", cohortNumber: "" });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this team?")) return;
    await fetch(`/api/teams/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/events/${params.id}`} className="text-sm text-slate-500 hover:text-brand">
          ← Event
        </Link>
        <h1 className="text-2xl font-bold">Teams</h1>
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold">Pre-register a batch</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">Count</label>
            <input
              type="number"
              className="input w-24"
              value={batch}
              onChange={(e) => setBatch(parseInt(e.target.value, 10) || 1)}
            />
          </div>
          <div>
            <label className="label">Starting #</label>
            <input
              type="number"
              className="input w-24"
              value={start}
              onChange={(e) => setStart(parseInt(e.target.value, 10) || 1)}
            />
          </div>
          <button className="btn btn-primary" onClick={addBatch}>
            Create
          </button>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Add one team</h2>
        <form onSubmit={addSingle} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input
            className="input sm:col-span-2"
            placeholder="Team name"
            value={single.name}
            onChange={(e) => setSingle((s) => ({ ...s, name: e.target.value }))}
          />
          <input
            className="input"
            type="number"
            placeholder="#"
            value={single.teamNumber}
            onChange={(e) => setSingle((s) => ({ ...s, teamNumber: e.target.value }))}
          />
          <input
            className="input"
            type="number"
            placeholder="Cohort"
            value={single.cohortNumber}
            onChange={(e) => setSingle((s) => ({ ...s, cohortNumber: e.target.value }))}
          />
          <button className="btn btn-primary sm:col-span-4">Add team</button>
        </form>
      </section>

      <ul className="space-y-2">
        {teams.map((t) => (
          <li key={t.id} className="card flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-sm font-bold text-slate-600">
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
                <div className="text-xs text-slate-500">
                  {t.cohortNumber ? `Cohort ${t.cohortNumber} · ` : ""}
                  {t.rosterUsers.length} roster
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Link href={`/admin/events/${params.id}/teams/${t.id}`} className="btn btn-secondary">
                Edit
              </Link>
              <button onClick={() => remove(t.id)} className="btn btn-ghost text-red-600">
                Remove
              </button>
            </div>
          </li>
        ))}
        {teams.length === 0 && <p className="text-slate-500">No teams yet.</p>}
      </ul>
    </div>
  );
}
