"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Team = {
  id: string;
  name: string;
  teamNumber: number;
  cohortNumber: number | null;
  photos: { id: string; s3Url: string; s3Key: string; displayOrder: number }[];
  rosterUsers: { id: string; name: string }[];
};

export default function TeamDetail({ params }: { params: { id: string; tid: string } }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [name, setName] = useState("");
  const [number, setNumber] = useState<number>(1);
  const [cohort, setCohort] = useState<string>("");
  const [rosterName, setRosterName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/teams/${params.tid}`);
    if (r.ok) {
      const t = (await r.json()).team as Team;
      setTeam(t);
      setName(t.name);
      setNumber(t.teamNumber);
      setCohort(t.cohortNumber ? String(t.cohortNumber) : "");
    }
  }, [params.tid]);

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
    if (!rosterName.trim()) return;
    await fetch(`/api/teams/${params.tid}/roster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: rosterName.trim() }),
    });
    setRosterName("");
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

  if (!team) return <p>Loading…</p>;

  return (
    <div className="space-y-6">
      <Link href={`/admin/events/${params.id}/teams`} className="text-sm text-slate-500 hover:text-brand">
        ← Teams
      </Link>

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
        <form onSubmit={addRoster} className="flex gap-2">
          <input
            className="input"
            placeholder="Player name"
            value={rosterName}
            onChange={(e) => setRosterName(e.target.value)}
          />
          <button className="btn btn-primary">Add</button>
        </form>
        <ul className="divide-y divide-slate-200">
          {team.rosterUsers.map((u) => (
            <li key={u.id} className="flex items-center justify-between py-2">
              <span>{u.name}</span>
              <button onClick={() => removeRoster(u.id)} className="text-sm text-red-600">
                Remove
              </button>
            </li>
          ))}
          {team.rosterUsers.length === 0 && <p className="text-slate-500">No roster yet.</p>}
        </ul>
      </section>
    </div>
  );
}
