"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useEventChannel } from "@/lib/pubnub-client";

// Extract the event id from either an admin or public event URL. The bare
// /admin/events listing has no id and must not match.
function eventIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/(?:admin|public)\/events\/([^/]+)(?:\/|$)/);
  return m ? m[1] : null;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

type TimerState = { running: boolean; startedAt: number | null };

/**
 * Global shared event stopwatch shown as a banner across every event screen.
 * State lives on the server (Event.timerRunning/timerStartedAt) and is pushed to
 * all phones via PubNub, so the time is identical everywhere. Admin screens get
 * Start / Stop controls; public viewers see a read-only display.
 */
export function EventTimerBanner() {
  const pathname = usePathname() ?? "";
  const eventId = eventIdFromPath(pathname);
  const canControl = pathname.startsWith("/admin");

  const [state, setState] = useState<TimerState>({ running: false, startedAt: null });
  const [loaded, setLoaded] = useState(false);
  // Difference between the server clock and this device's clock, so phones with
  // skewed clocks still derive the same elapsed time from the shared startedAt.
  const clockOffset = useRef(0);
  const [, forceTick] = useState(0);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    if (!eventId) return;
    try {
      const r = await fetch(`/api/events/${eventId}/timer`, { cache: "no-store" });
      if (!r.ok) return;
      const { timer } = (await r.json()) as {
        timer: { running: boolean; startedAt: number | null; serverNow: number };
      };
      clockOffset.current = timer.serverNow - Date.now();
      setState({ running: timer.running, startedAt: timer.startedAt });
    } finally {
      setLoaded(true);
    }
  }, [eventId]);

  useEffect(() => {
    setLoaded(false);
    refresh();
  }, [refresh]);

  // Live push from any phone that starts/stops the timer.
  useEventChannel(eventId, (msg) => {
    const m = msg as { type?: string; payload?: { running?: boolean; startedAt?: number | null } };
    if (m?.type !== "timer_updated" || !m.payload) return;
    setState({ running: !!m.payload.running, startedAt: m.payload.startedAt ?? null });
  });

  // Re-render every 250ms while running so the displayed time counts up.
  useEffect(() => {
    if (!state.running) return;
    const id = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [state.running]);

  const send = useCallback(
    async (action: "start" | "stop") => {
      if (!eventId) return;
      setPending(true);
      try {
        const r = await fetch(`/api/events/${eventId}/timer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (r.ok) {
          const { timer } = (await r.json()) as {
            timer: { running: boolean; startedAt: number | null; serverNow: number };
          };
          clockOffset.current = timer.serverNow - Date.now();
          setState({ running: timer.running, startedAt: timer.startedAt });
        }
      } finally {
        setPending(false);
      }
    },
    [eventId],
  );

  if (!eventId || !loaded) return null;

  const elapsedMs =
    state.running && state.startedAt != null
      ? Date.now() + clockOffset.current - state.startedAt
      : 0;

  return (
    <>
      <div
        className={`flex h-14 items-center justify-between gap-3 px-4 ${
          state.running ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-100"
        }`}
        role="timer"
        aria-live="off"
      >
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              state.running ? "animate-pulse bg-white" : "bg-slate-500"
            }`}
            aria-hidden
          />
          <span className="text-xs font-semibold uppercase tracking-wide opacity-80">
            Event timer
          </span>
          <span className="font-mono text-2xl font-bold tabular-nums leading-none sm:text-3xl">
            {formatElapsed(elapsedMs)}
          </span>
        </div>

        {canControl && (
          <div className="flex items-center gap-2">
            {state.running ? (
              <button
                className="rounded-md bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25 disabled:opacity-50"
                onClick={() => setConfirmingStop(true)}
                disabled={pending}
              >
                Stop
              </button>
            ) : (
              <button
                className="rounded-md bg-white px-4 py-1.5 text-sm font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                onClick={() => send("start")}
                disabled={pending}
              >
                Start
              </button>
            )}
          </div>
        )}
      </div>

      {confirmingStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-sm space-y-3 text-slate-900">
            <h3 className="text-lg font-semibold">Stop the event timer?</h3>
            <p className="text-sm text-slate-600">
              This stops <strong>and resets</strong> the timer to 0 for everyone watching this
              event. This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmingStop(false)}
                disabled={pending}
              >
                Keep running
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await send("stop");
                  setConfirmingStop(false);
                }}
                disabled={pending}
              >
                {pending ? "Stopping…" : "Yes, stop & reset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
