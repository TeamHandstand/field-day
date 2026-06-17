"use client";
import { useEffect, useRef, useState } from "react";

// "Microwave"-style time entry: a single field that always shows the colon and
// fills digits from the right. Typing "1" → 0:01, "12" → 0:12, "123" → 1:23,
// "1234" → 12:34 — each new digit shifts the rest left. The rightmost two digits
// are seconds, everything before them is minutes. Reads/writes a single
// decimal-seconds string so callers are unchanged.

const MAX_DIGITS = 6; // up to 9999:99 — far more than any field event needs.

// Keep only significant digits (drop leading zeros), capped in length.
function normalizeDigits(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_DIGITS);
}

// Digit buffer -> total whole seconds, as the decimal-seconds string we emit.
function digitsToSeconds(digits: string): string {
  if (digits === "") return "";
  const padded = digits.padStart(3, "0");
  const secs = parseInt(padded.slice(-2), 10);
  const mins = parseInt(padded.slice(0, -2), 10);
  return String(mins * 60 + secs);
}

// Stored decimal-seconds value -> digit buffer. Rounds to whole seconds, since
// the microwave entry is digit-by-digit; sub-second precision isn't typeable.
function secondsToDigits(value: string): string {
  if (value === "" || value == null) return "";
  const total = parseFloat(value);
  if (!Number.isFinite(total)) return "";
  const whole = Math.round(Math.abs(total));
  if (whole === 0) return "";
  const mins = Math.floor(whole / 60);
  const secs = whole - mins * 60;
  return normalizeDigits(`${mins}${String(secs).padStart(2, "0")}`);
}

// Digit buffer -> "M:SS" display. The colon is always present once any digit is
// entered; an empty buffer shows the placeholder instead.
function formatDisplay(digits: string): string {
  if (digits === "") return "";
  const padded = digits.padStart(3, "0");
  const secs = padded.slice(-2);
  const mins = String(parseInt(padded.slice(0, -2), 10));
  return `${mins}:${secs}`;
}

export function TimeInput({
  value,
  onChange,
  autoFocus = false,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [digits, setDigits] = useState(() => secondsToDigits(value));
  const lastEmitted = useRef<string>(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // External value changed (initial load, reset). Re-sync only if we didn't emit it ourselves.
    if (value !== lastEmitted.current) {
      setDigits(secondsToDigits(value));
      lastEmitted.current = value;
    }
  }, [value]);

  // Pin the caret to the end so editing always behaves like a microwave keypad:
  // new digits append on the right and backspace removes from the right.
  useEffect(() => {
    const el = inputRef.current;
    if (el && document.activeElement === el) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }, [digits]);

  const apply = (raw: string) => {
    const next = normalizeDigits(raw);
    setDigits(next);
    const out = digitsToSeconds(next);
    lastEmitted.current = out;
    onChange(out);
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        placeholder="0:00"
        className="input text-lg tabular-nums"
        value={formatDisplay(digits)}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => apply(e.target.value)}
      />
      <div className="mt-0.5 text-xs text-slate-500">minutes : seconds</div>
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
