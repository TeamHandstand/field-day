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
  // Which event's "⋯" menu is open (Scoring / Audit live here now, not in the
  // per-event nav bar).
  const [menuFor, setMenuFor] = useState<string | null>(null);

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
            <div className="flex items-center gap-2">
              <Link href={`/admin/events/${ev.id}`} className="btn btn-secondary">
                Open
              </Link>
              <div className="relative">
                <button
                  type="button"
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={menuFor === ev.id}
                  className="btn btn-secondary px-2.5 text-lg leading-none"
                  onClick={() => setMenuFor(menuFor === ev.id ? null : ev.id)}
                >
                  ⋯
                </button>
                {menuFor === ev.id && (
                  <>
                    {/* Click-away layer */}
                    <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                    <div
                      role="menu"
                      className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                    >
                      <Link
                        href={`/admin/events/${ev.id}/activities`}
                        role="menuitem"
                        className="block px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                        onClick={() => setMenuFor(null)}
                      >
                        Scoring
                      </Link>
                      <Link
                        href={`/admin/events/${ev.id}/audit`}
                        role="menuitem"
                        className="block px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                        onClick={() => setMenuFor(null)}
                      >
                        Audit
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
        {events.length === 0 && <p className="text-slate-500">No events yet.</p>}
      </ul>
    </div>
  );
}
