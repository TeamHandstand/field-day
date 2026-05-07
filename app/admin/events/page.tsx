"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type EventRow = {
  id: string;
  name: string;
  isLocked: boolean;
  isFinalized: boolean;
  createdAt: string;
  _count: { teams: number; activities: number };
};

export default function EventsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const r = await fetch("/api/events");
    if (r.ok) setEvents((await r.json()).events);
  };

  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    const r = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setCreating(false);
    if (r.ok) {
      setName("");
      load();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Events</h1>
        <p className="text-sm text-slate-600">Create and manage your scoring events.</p>
      </div>

      <form onSubmit={create} className="card flex flex-col gap-3 sm:flex-row">
        <input
          className="input"
          placeholder="New event name (e.g., Cabo Cup 2026)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-primary" disabled={creating}>
          {creating ? "Creating…" : "Create event"}
        </button>
      </form>

      <ul className="space-y-3">
        {events.map((ev) => (
          <li key={ev.id} className="card flex items-center justify-between">
            <div>
              <Link href={`/admin/events/${ev.id}`} className="text-lg font-semibold hover:text-brand">
                {ev.name}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span>{ev._count.teams} teams</span>
                <span>·</span>
                <span>{ev._count.activities} activities</span>
                {ev.isFinalized ? (
                  <span className="badge badge-blue">Finalized</span>
                ) : ev.isLocked ? (
                  <span className="badge badge-amber">Locked</span>
                ) : (
                  <span className="badge badge-green">In progress</span>
                )}
              </div>
            </div>
            <Link href={`/admin/events/${ev.id}`} className="btn btn-secondary">
              Open
            </Link>
          </li>
        ))}
        {events.length === 0 && <p className="text-slate-500">No events yet.</p>}
      </ul>
    </div>
  );
}
