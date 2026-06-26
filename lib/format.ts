// Unit-aware formatting for recorded measurement values shown across the app.

import type { InputRule } from "./scoring";

const POUND_UNITS = new Set(["pounds", "pound", "lb", "lbs"]);
const SECOND_UNITS = new Set(["seconds", "second", "sec", "secs", "s"]);

export function isPoundUnit(unit: string | undefined | null): boolean {
  return unit != null && POUND_UNITS.has(unit.trim().toLowerCase());
}

export function isSecondsUnit(unit: string | undefined | null): boolean {
  return unit != null && SECOND_UNITS.has(unit.trim().toLowerCase());
}

// Seconds rendered compactly: under a minute as "44s" (or "44.5s"); a minute or
// more as "2m 44s". Negative values keep a leading sign (used for deviations).
export function formatDuration(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const total = Math.round(Math.abs(totalSeconds) * 100) / 100;
  // Round to 2 decimals and drop trailing zeros: 44.5 → "44.5", 44 → "44".
  const fmtSecs = (s: number) => (Math.round(s * 100) / 100).toString();
  if (total < 60) return `${sign}${fmtSecs(total)}s`;
  const mins = Math.floor(total / 60);
  const secs = Math.round((total - mins * 60) * 100) / 100;
  return secs === 0 ? `${sign}${mins}m 0s` : `${sign}${mins}m ${fmtSecs(secs)}s`;
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

// A measured value with its unit, ready to display. Time values (seconds) render
// as a duration ("2m 44s") with the unit baked in; everything else is the numeric
// value followed by its unit ("110 grams").
export function formatMeasureWithUnit(value: number, unit?: string | null): string {
  if (isSecondsUnit(unit)) return formatDuration(value);
  return withUnit(formatMeasure(value, unit), unit);
}

// "over"  → recorded value is above target
// "under" → below target
// "on"    → exactly on target
// "none"  → not a signed deviation (plain value / score)
export type DeviationTone = "over" | "under" | "on" | "none";

type SummaryField = { id: string; unit: string; targetValue: number | null };

// Signed gap from a target, tone-coded so over/under/on-target read at a glance.
// Time deviations render as durations ("+2m 4s"); everything else as the numeric
// gap with its unit ("+0.42 seconds" → "+0.42s", "-2 grams").
export function formatDeviation(
  value: number,
  target: number,
  unit?: string | null,
): { text: string; tone: DeviationTone } {
  const diff = value - target;
  const tone: DeviationTone = diff > 0 ? "over" : diff < 0 ? "under" : "on";
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  const magnitude = isSecondsUnit(unit)
    ? formatDuration(Math.abs(diff))
    : withUnit(formatMeasure(Math.abs(diff), unit), unit);
  return { text: `${sign}${magnitude}`, tone };
}

// Summarize a logged sub-activity result for host-facing lists.
//  - abs_deviation_from_target / sum_of_pct_deviation with a single targeted
//    field: show the SIGNED gap from target ("+0.42s", "-2 grams"), tone-coded.
//  - single_value: show the value the host recorded ("2m 44s" for times).
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
    return { text: formatMeasureWithUnit(v, unit), tone: "none" };
  }

  if (
    (inputRule === "abs_deviation_from_target" || inputRule === "sum_of_pct_deviation") &&
    fields.length === 1 &&
    fields[0].targetValue != null &&
    rawByField.has(fields[0].id)
  ) {
    return formatDeviation(rawByField.get(fields[0].id)!, fields[0].targetValue!, unit);
  }

  return { text: formatMeasureWithUnit(computedValue, unit), tone: "none" };
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
