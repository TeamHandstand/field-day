import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatMeasureWithUnit,
  formatDeviation,
  summarizeRecorded,
} from "./format";

describe("formatDuration", () => {
  it("shows sub-minute values in seconds", () => {
    expect(formatDuration(44)).toBe("44s");
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(44.5)).toBe("44.5s");
  });

  it("shows a minute or more as Xm Ys", () => {
    expect(formatDuration(164)).toBe("2m 44s");
    expect(formatDuration(60)).toBe("1m 0s");
    expect(formatDuration(125.25)).toBe("2m 5.25s");
  });

  it("keeps a leading sign for negatives", () => {
    expect(formatDuration(-90)).toBe("-1m 30s");
    expect(formatDuration(-12)).toBe("-12s");
  });

  it("carries rounding without producing 60 seconds", () => {
    expect(formatDuration(119.999)).toBe("2m 0s");
  });
});

describe("formatMeasureWithUnit", () => {
  it("formats seconds as a duration", () => {
    expect(formatMeasureWithUnit(164, "seconds")).toBe("2m 44s");
  });
  it("formats other units as value + unit", () => {
    expect(formatMeasureWithUnit(110, "grams")).toBe("110 grams");
    expect(formatMeasureWithUnit(12.5, "lbs")).toBe("12.5 lbs");
  });
});

describe("formatDeviation", () => {
  it("signs over/under and tone-codes", () => {
    expect(formatDeviation(110, 100, "grams")).toEqual({ text: "+10 grams", tone: "over" });
    expect(formatDeviation(90, 100, "grams")).toEqual({ text: "-10 grams", tone: "under" });
    expect(formatDeviation(100, 100, "grams")).toEqual({ text: "0 grams", tone: "on" });
  });
  it("renders time deviations as durations", () => {
    expect(formatDeviation(184, 60, "seconds")).toEqual({ text: "+2m 4s", tone: "over" });
  });

  it("wraps circular (compass) deviations to the shortest signed offset", () => {
    // 357° against North (0°) is only 3° short, not 357° over.
    expect(formatDeviation(357, 0, "degrees", true)).toEqual({ text: "-3 degrees", tone: "under" });
    expect(formatDeviation(5, 0, "degrees", true)).toEqual({ text: "+5 degrees", tone: "over" });
    expect(formatDeviation(190, 0, "degrees", true)).toEqual({ text: "-170 degrees", tone: "under" });
    // Wrap relative to a non-zero target: 10° vs 350° is +20°.
    expect(formatDeviation(10, 350, "degrees", true)).toEqual({ text: "+20 degrees", tone: "over" });
  });
});

describe("summarizeRecorded with time", () => {
  it("formats a single_value time over a minute", () => {
    const r = summarizeRecorded(
      "single_value",
      [{ id: "f1", unit: "seconds", targetValue: null }],
      new Map([["f1", 164]]),
      164,
    );
    expect(r).toEqual({ text: "2m 44s", tone: "none" });
  });
});
