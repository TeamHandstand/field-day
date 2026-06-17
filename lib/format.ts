// Unit-aware formatting for recorded measurement values shown across the app.

import type { InputRule } from "./scoring";

const POUND_UNITS = new Set(["pounds", "pound", "lb", "lbs"]);

export function isPoundUnit(unit: string | undefined | null): boolean {
  return unit != null && POUND_UNITS.has(unit.trim().toLowerCase());
}

// Format the numeric part of a measurement. Pounds always show one decimal place;
// other units stay whole when integer and otherwise show up to two decimals.
export function formatMeasure(value: number, unit?: string | null): string {
  if (isPoundUnit(unit)) return value.toFixed(1);
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(2);
}

function withUnit(num: string, unit?: string | null): string {
  return unit ? `${num} ${unit}` : num;
}

// Clock time (decimal seconds) rendered as m:ss.
function formatClock(value: number): string {
  const total = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const mins = Math.floor(total / 60);
  const secs = total - mins * 60;
  const secsStr = (Number.isInteger(secs) ? secs.toString() : secs.toFixed(2)).padStart(
    Number.isInteger(secs) ? 2 : 5,
    "0",
  );
  return `${sign}${mins}:${secsStr}`;
}

// Whether a sub-activity should render as a m:ss clock time.
function isClockTime(rule: InputRule, unit: string): boolean {
  return rule === "single_value" && unit.trim().toLowerCase() === "seconds";
}

// "over"  → recorded value is above target
// "under" → below target
// "on"    → exactly on target
// "none"  → not a signed deviation (plain value / score)
export type DeviationTone = "over" | "under" | "on" | "none";

type SummaryField = { id: string; unit: string; targetValue: number | null };

// Summarize a logged sub-activity result for host-facing lists.
//  - abs_deviation_from_target / sum_of_pct_deviation with a single targeted
//    field: show the SIGNED gap from target ("+0.42 seconds", "-2 grams"),
//    tone-coded so over/under/on-target read at a glance.
//  - single_value: show the value the host recorded (m:ss when it's a clock time).
//  - anything else (compass offset, banana-split gap, multi-attempt sums): fall
//    back to the computed score.
export function summarizeRecorded(
  inputRule: InputRule,
  fields: SummaryField[],
  rawByField: Map<string, number>,
  computedValue: number,
): { text: string; tone: DeviationTone } {
  const unit = fields[0]?.unit ?? "";

  if (inputRule === "single_value") {
    const f = fields[0];
    const v = f && rawByField.has(f.id) ? rawByField.get(f.id)! : computedValue;
    if (isClockTime(inputRule, unit)) return { text: formatClock(v), tone: "none" };
    return { text: withUnit(formatMeasure(v, unit), unit), tone: "none" };
  }

  if (
    (inputRule === "abs_deviation_from_target" || inputRule === "sum_of_pct_deviation") &&
    fields.length === 1 &&
    fields[0].targetValue != null &&
    rawByField.has(fields[0].id)
  ) {
    const diff = rawByField.get(fields[0].id)! - fields[0].targetValue!;
    const tone: DeviationTone = diff > 0 ? "over" : diff < 0 ? "under" : "on";
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
    return { text: withUnit(`${sign}${formatMeasure(Math.abs(diff), unit)}`, unit), tone };
  }

  return { text: withUnit(formatMeasure(computedValue, unit), unit), tone: "none" };
}

// Tailwind text colour for a deviation tone.
export function deviationToneClass(tone: DeviationTone): string {
  switch (tone) {
    case "over":
      return "text-rose-600";
    case "under":
      return "text-blue-600";
    case "on":
      return "text-green-600";
    default:
      return "text-slate-700";
  }
}
