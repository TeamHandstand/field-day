import { describe, expect, it } from "vitest";
import { validateAndComputeSub } from "./scoring-save";

const single = {
  id: "s1",
  name: "Point North",
  inputRule: "single_value" as const,
  sortDirection: "asc" as const,
  inputFields: [{ id: "f1", label: "Degrees off North", targetValue: null }],
};

const pct = {
  id: "s2",
  name: "Timer Test",
  inputRule: "sum_of_pct_deviation" as const,
  sortDirection: "asc" as const,
  inputFields: [
    { id: "a", label: "Attempt 1", targetValue: 30 },
    { id: "b", label: "Attempt 2", targetValue: 60 },
  ],
};

describe("validateAndComputeSub", () => {
  it("computes a single value as-is", () => {
    expect(validateAndComputeSub(single, { f1: 42 })).toBe(42);
  });

  it("throws when a required input is missing", () => {
    expect(() => validateAndComputeSub(pct, { a: 30 })).toThrow(/Attempt 2/);
  });

  it("throws when a required input is not finite", () => {
    expect(() => validateAndComputeSub(single, { f1: NaN })).toThrow(/Degrees off North/);
  });

  it("throws when a pct-deviation target is zero or missing", () => {
    const bad = { ...pct, inputFields: [{ id: "a", label: "Attempt 1", targetValue: 0 }] };
    expect(() => validateAndComputeSub(bad, { a: 30 })).toThrow(/non-zero targets/);
  });

  it("computes sum of percent deviation across attempts", () => {
    // |30-30|/30 + |90-60|/60 = 0% + 50% = 50%
    expect(validateAndComputeSub(pct, { a: 30, b: 90 })).toBeCloseTo(50, 5);
  });
});
