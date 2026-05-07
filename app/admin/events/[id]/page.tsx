"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type EventDetail = {
  id: string;
  name: string;
  isLocked: boolean;
  isFinalized: boolean;
  finalizedAt: string | null;
  teams: { id: string; name: string; teamNumber: number }[];
  activities: { id: string; name: string; subActivities: unknown[] }[];
};

type Gap = {
  teamId: string;
  teamName: string;
  teamNumber: number;
  missing: { activityId: string; activityName: string; subActivityIds: string[] }[];
};

export default function EventDashboard({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [data, setData] = useState<EventDetail | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [showFinalize, setShowFinalize] = useState(false);
  const [gaps, setGaps] = useState<Gap[]>([]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/events/${params.id}`);
    if (r.ok) {
      const d = (await r.json()).event;
      setData(d);
      setName(d.name);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const finalize = async () => {
    const r = await fetch(`/api/events/${params.id}/finalize`);
    if (r.ok) {
      setGaps((await r.json()).gaps);
      setShowFinalize(true);
    }
  };

  const confirmFinalize = async () => {
    const r = await fetch(`/api/events/${params.id}/finalize`, { method: "POST" });
    if (r.ok) {
      setShowFinalize(false);
      load();
    } else {
      alert("Finalize failed: " + (await r.text()));
    }
  };

  const unlock = async () => {
    if (!confirm("Unlock this event? Stamped scores stay visible until you re-finalize.")) return;
    await fetch(`/api/events/${params.id}/unlock`, { method: "POST" });
    load();
  };

  const rename = async () => {
    await fetch(`/api/events/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRenaming(false);
    load();
  };

  const remove = async () => {
    if (!confirm("Delete this event and all its data? This cannot be undone.")) return;
    await fetch(`/api/events/${params.id}`, { method: "DELETE" });
    router.push("/admin/events");
  };

  if (!data) return <p>Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {renaming ? (
            <div className="flex items-center gap-2">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn btn-primary" onClick={rename}>
                Save
              </button>
              <button className="btn btn-ghost" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{data.name}</h1>
              {!data.isLocked && (
                <button className="btn btn-ghost text-sm" onClick={() => setRenaming(true)}>
                  Edit
                </button>
              )}
            </div>
          )}
          <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
            {data.isFinalized ? (
              <span className="badge badge-blue">Finalized</span>
            ) : data.isLocked ? (
              <span className="badge badge-amber">Locked</span>
            ) : (
              <span className="badge badge-green">In progress</span>
            )}
            <span>·</span>
            <span>{data.teams.length} teams</span>
            <span>·</span>
            <span>{data.activities.length} activities</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/events/${data.id}/teams`} className="btn btn-secondary">
            Teams
          </Link>
          <Link href={`/admin/events/${data.id}/activities`} className="btn btn-secondary">
            Activities
          </Link>
          <Link href={`/admin/events/${data.id}/leaderboard`} className="btn btn-secondary">
            Leaderboard
          </Link>
          <Link href={`/public/events/${data.id}`} target="_blank" className="btn btn-ghost">
            Public view ↗
          </Link>
        </div>
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold">Score logging</h2>
        <p className="text-sm text-slate-600">Tap an activity to log scores.</p>
        <ul className="mt-3 space-y-2">
          {data.activities.map((a) => (
            <li key={a.id}>
              <Link
                href={`/admin/events/${data.id}/activities/${a.id}/log`}
                className="card flex items-center justify-between hover:border-brand"
              >
                <span className="font-medium">{a.name}</span>
                <span className="text-sm text-slate-500">Log →</span>
              </Link>
            </li>
          ))}
          {data.activities.length === 0 && (
            <p className="text-sm text-slate-500">No activities yet — add some on the Activities page.</p>
          )}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Event lifecycle</h2>
        {!data.isFinalized ? (
          <button className="btn btn-primary" onClick={finalize}>
            End Event & Finalize Scores
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              Finalized {data.finalizedAt && new Date(data.finalizedAt).toLocaleString()}
            </p>
            <div className="flex flex-wrap gap-2">
              {data.isLocked ? (
                <button className="btn btn-secondary" onClick={unlock}>
                  Unlock to edit
                </button>
              ) : (
                <button className="btn btn-primary" onClick={confirmFinalize}>
                  Re-finalize
                </button>
              )}
            </div>
          </div>
        )}
        <button className="btn btn-danger" onClick={remove}>
          Delete event
        </button>
      </section>

      {showFinalize && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="card max-h-[80vh] w-full max-w-lg overflow-y-auto">
            <h3 className="text-lg font-semibold">Finalize {data.name}?</h3>
            <p className="mt-1 text-sm text-slate-600">
              Activity ranks and points will be stamped, and the event will be locked.
              Any team with missing scores earns 0 points for that activity.
            </p>
            {gaps.length > 0 ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm font-semibold text-amber-700">
                  {gaps.length} team{gaps.length === 1 ? "" : "s"} have gaps:
                </p>
                <ul className="space-y-2 text-sm">
                  {gaps.map((g) => (
                    <li key={g.teamId} className="rounded-md bg-amber-50 p-2">
                      <div className="font-medium">
                        #{g.teamNumber} {g.teamName}
                      </div>
                      <ul className="ml-4 list-disc text-xs text-slate-600">
                        {g.missing.map((m) => (
                          <li key={m.activityId}>
                            {m.activityName} ({m.subActivityIds.length} sub-activity)
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-3 text-sm text-green-700">All teams have complete scores.</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setShowFinalize(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={confirmFinalize}>
                Finalize anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
