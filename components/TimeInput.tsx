"use client";
import { useEffect, useRef, useState } from "react";

// Two-field min:sec entry that reads/writes a single decimal-seconds string.
// Used for inputs where unit === "seconds" and the user thinks in clock time.

function splitSeconds(value: string): { m: string; s: string } {
  if (value === "" || value == null) return { m: "", s: "" };
  const total = parseFloat(value);
  if (!Number.isFinite(total)) return { m: "", s: "" };
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const mins = Math.floor(abs / 60);
  const secs = abs - mins * 60;
  return {
    m: mins === 0 ? "" : String(sign * mins),
    s: secs === 0 ? "0" : String(parseFloat(secs.toFixed(3))),
  };
}

function combine(m: string, s: string): string {
  if (m === "" && s === "") return "";
  const mNum = parseFloat(m);
  const sNum = parseFloat(s);
  const safeM = Number.isFinite(mNum) ? mNum : 0;
  const safeS = Number.isFinite(sNum) ? sNum : 0;
  return String(safeM * 60 + safeS);
}

export function TimeInput({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const [m, setM] = useState(() => splitSeconds(value).m);
  const [s, setS] = useState(() => splitSeconds(value).s);
  const lastEmitted = useRef<string>(value);

  useEffect(() => {
    // External value changed (initial load, reset). Re-sync only if we didn't emit it ourselves.
    if (value !== lastEmitted.current) {
      const parts = splitSeconds(value);
      setM(parts.m);
      setS(parts.s);
      lastEmitted.current = value;
    }
  }, [value]);

  const push = (nextM: string, nextS: string) => {
    setM(nextM);
    setS(nextS);
    const out = combine(nextM, nextS);
    lastEmitted.current = out;
    onChange(out);
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <input
          type="number"
          inputMode="numeric"
          step="1"
          min="0"
          placeholder="min"
          className="input text-lg"
          value={m}
          autoFocus={autoFocus}
          onChange={(e) => push(e.target.value, s)}
        />
        <div className="mt-0.5 text-xs text-slate-500">minutes</div>
      </div>
      <div>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          placeholder="sec"
          className="input text-lg"
          value={s}
          onChange={(e) => push(m, e.target.value)}
        />
        <div className="mt-0.5 text-xs text-slate-500">seconds</div>
      </div>
    </div>
  );
}

// Heuristic: when do we show the min:sec UI vs a plain number input?
// Only for single_value inputs measured in "seconds" (Cross the Ocean, Team
// Slingshot, etc.). Sub-activities like Timer Test (sum_of_pct_deviation with
// 30/60/90s targets) keep a single decimal-seconds field — splitting those
// into min:sec would feel awkward.
export function shouldUseTimeInput(
  inputRule: "single_value" | "sum_of_pct_deviation" | "abs_deviation_from_target",
  unit: string,
): boolean {
  return inputRule === "single_value" && unit.trim().toLowerCase() === "seconds";
}
