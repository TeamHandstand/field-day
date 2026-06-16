// Unit-aware formatting for recorded measurement values shown across the app.

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
