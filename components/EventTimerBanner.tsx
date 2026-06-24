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

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const MIN_MINUTES = 1;
const MAX_MINUTES = 600;
function clampMinutes(n: number): number {
  if (!Number.isFinite(n)) return 20;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(n)));
}

type TimerState = { running: boolean; startedAt: number | null; durationSeconds: number };

/**
 * Global shared event countdown timer shown as a banner across every event
 * screen. State lives on the server (Event.timer*) and is pushed to all phones
 * via PubNub, so the countdown is identical everywhere. Admins can set the
 * length (default 20 min), Start it, and Stop it (double-confirmed); public
 * viewers see a read-only countdown.
 */
export function EventTimerBanner() {
  const pathname = usePathname() ?? "";
  const eventId = eventIdFromPath(pathname);
  const canControl = pathname.startsWith("/admin");

  const [state, setState] = useState<TimerState>({
    running: false,
    startedAt: null,
    durationSeconds: 1200,
  });
  const [loaded, setLoaded] = useState(false);
  // Difference between the server clock and this device's clock, so phones with
  // skewed clocks still derive the same remaining time from the shared startedAt.
  const clockOffset = useRef(0);
  const [, forceTick] = useState(0);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [pending, setPending] = useState(false);

  // Editable duration (whole minutes) shown while stopped. Kept in sync with the
  // server value except while the admin is actively typing into the field.
  const [minutesInput, setMinutesInput] = useState("20");
  const editingRef = useRef(false);

  const applyTimer = useCallback(
    (timer: { running: boolean; startedAt: number | null; durationSeconds: number; serverNow?: number }) => {
      if (typeof timer.serverNow === "number") clockOffset.current = timer.serverNow - Date.now();
      setState({
        running: timer.running,
        startedAt: timer.startedAt,
        durationSeconds: timer.durationSeconds,
      });
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!eventId) return;
    try {
      const r = await fetch(`/api/events/${eventId}/timer`, { cache: "no-store" });
      if (!r.ok) return;
      const { timer } = await r.json();
      applyTimer(timer);
    } finally {
      setLoaded(true);
    }
  }, [eventId, applyTimer]);

  useEffect(() => {
    setLoaded(false);
    refresh();
  }, [refresh]);

  // Keep the minutes field in sync with the shared duration unless mid-edit.
  useEffect(() => {
    if (!editingRef.current) setMinutesInput(String(Math.round(state.durationSeconds / 60)));
  }, [state.durationSeconds]);

  // Live push from any phone that starts/stops or re-times the timer.
  useEventChannel(eventId, (msg) => {
    const m = msg as {
      type?: string;
      payload?: { running?: boolean; startedAt?: number | null; durationSeconds?: number };
    };
    if (m?.type !== "timer_updated" || !m.payload) return;
    setState({
      running: !!m.payload.running,
      startedAt: m.payload.startedAt ?? null,
      durationSeconds: m.payload.durationSeconds ?? 1200,
    });
  });

  // Re-render every 250ms while running so the displayed countdown ticks down.
  useEffect(() => {
    if (!state.running) return;
    const id = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [state.running]);

  const send = useCallback(
    async (action: "start" | "stop" | "set_duration", durationSeconds?: number) => {
      if (!eventId) return;
      setPending(true);
      try {
        const r = await fetch(`/api/events/${eventId}/timer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, durationSeconds }),
        });
        if (r.ok) {
          const { timer } = await r.json();
          applyTimer(timer);
        }
      } finally {
        setPending(false);
      }
    },
    [eventId, applyTimer],
  );

  if (!eventId || !loaded) return null;

  const editedMinutes = clampMinutes(parseFloat(minutesInput));
  const remainingMs =
    state.running && state.startedAt != null
      ? Math.max(0, state.durationSeconds * 1000 - (Date.now() + clockOffset.current - state.startedAt))
      : // When stopped, preview whatever length is currently dialed in.
        editedMinutes * 60 * 1000;
  const timeUp = state.running && remainingMs <= 0;

  const commitDuration = () => {
    editingRef.current = false;
    const secs = editedMinutes * 60;
    setMinutesInput(String(editedMinutes));
    if (secs !== state.durationSeconds && !state.running) send("set_duration", secs);
  };

  const bannerTone = timeUp
    ? "bg-red-600 text-white"
    : state.running
      ? "bg-emerald-600 text-white"
      : "bg-slate-800 text-slate-100";

  return (
    <>
      <div
        className={`flex h-14 items-center justify-between gap-3 px-4 ${bannerTone}`}
        role="timer"
        aria-live="off"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              timeUp ? "bg-white" : state.running ? "animate-pulse bg-white" : "bg-slate-500"
            }`}
            aria-hidden
          />
          <span className="hidden text-xs font-semibold uppercase tracking-wide opacity-80 sm:inline">
            {timeUp ? "Time's up" : "Event timer"}
          </span>
          <span className="font-mono text-2xl font-bold tabular-nums leading-none sm:text-3xl">
            {formatClock(remainingMs)}
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
              <>
                {/* Length picker (whole minutes), persisted to all phones. */}
                <div className="flex items-center gap-1 rounded-md bg-white/10 px-1 py-0.5">
                  <button
                    className="h-7 w-7 rounded text-lg font-bold leading-none hover:bg-white/15 disabled:opacity-40"
                    onClick={() => {
                      editingRef.current = false;
                      const next = clampMinutes(editedMinutes - 1);
                      setMinutesInput(String(next));
                      if (next * 60 !== state.durationSeconds) send("set_duration", next * 60);
                    }}
                    disabled={pending || editedMinutes <= MIN_MINUTES}
                    aria-label="Decrease minutes"
                  >
                    −
                  </button>
                  <input
                    className="w-10 bg-transparent text-center text-sm font-semibold outline-none"
                    type="number"
                    inputMode="numeric"
                    min={MIN_MINUTES}
                    max={MAX_MINUTES}
                    value={minutesInput}
                    onFocus={() => (editingRef.current = true)}
                    onChange={(e) => setMinutesInput(e.target.value)}
                    onBlur={commitDuration}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    aria-label="Timer length in minutes"
                  />
                  <button
                    className="h-7 w-7 rounded text-lg font-bold leading-none hover:bg-white/15 disabled:opacity-40"
                    onClick={() => {
                      editingRef.current = false;
                      const next = clampMinutes(editedMinutes + 1);
                      setMinutesInput(String(next));
                      if (next * 60 !== state.durationSeconds) send("set_duration", next * 60);
                    }}
                    disabled={pending || editedMinutes >= MAX_MINUTES}
                    aria-label="Increase minutes"
                  >
                    +
                  </button>
                  <span className="pr-1 text-xs opacity-70">min</span>
                </div>
                <button
                  className="rounded-md bg-white px-4 py-1.5 text-sm font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                  onClick={() => {
                    editingRef.current = false;
                    send("start", editedMinutes * 60);
                  }}
                  disabled={pending}
                >
                  Start
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {confirmingStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-sm space-y-3 text-slate-900">
            <h3 className="text-lg font-semibold">Stop the event timer?</h3>
            <p className="text-sm text-slate-600">
              This stops <strong>and resets</strong> the countdown for everyone watching this
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
