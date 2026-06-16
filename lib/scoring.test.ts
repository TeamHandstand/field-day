import { describe, expect, it } from "vitest";
import {
  computeValue,
  rankWithAveragedTies,
  rankActivity,
  rankActivityLive,
  pointsForActivity,
  finalize,
  computeLiveStandings,
  rankTotalsWithTiebreak,
  firstPlaceCounts,
  type ActivityShape,
} from "./scoring";

describe("computeValue", () => {
  it("returns single value as-is", () => {
    const sub = {
      id: "s1",
      inputRule: "single_value" as const,
      sortDirection: "asc" as const,
      inputFields: [{ id: "f1", targetValue: null }],
    };
    expect(computeValue(sub, { f1: 42 })).toBe(42);
  });

  it("computes sum of percent deviation", () => {
    const sub = {
      id: "s1",
      inputRule: "sum_of_pct_deviation" as const,
      sortDirection: "asc" as const,
      inputFields: [
        { id: "a", targetValue: 30 },
        { id: "b", targetValue: 60 },
        { id: "c", targetValue: 90 },
      ],
    };
    // 33 vs 30 -> 10%, 54 vs 60 -> 10%, 99 vs 90 -> 10%. Sum = 30.
    expect(computeValue(sub, { a: 33, b: 54, c: 99 })).toBeCloseTo(30, 5);
  });

  it("throws if deviation target is zero", () => {
    const sub = {
      id: "s1",
      inputRule: "sum_of_pct_deviation" as const,
      sortDirection: "asc" as const,
      inputFields: [{ id: "a", targetValue: 0 }],
    };
    expect(() => computeValue(sub, { a: 5 })).toThrow();
  });

  it("computes abs deviation", () => {
    const sub = {
      id: "s1",
      inputRule: "abs_deviation_from_target" as const,
      sortDirection: "asc" as const,
      inputFields: [{ id: "a", targetValue: 0 }],
    };
    expect(computeValue(sub, { a: -7 })).toBe(7);
    expect(computeValue(sub, { a: 5 })).toBe(5);
  });

  it("computes circular deviation from North with wraparound", () => {
    const sub = {
      id: "s1",
      inputRule: "circular_deviation" as const,
      sortDirection: "asc" as const,
      inputFields: [{ id: "a", targetValue: 0 }],
    };
    expect(computeValue(sub, { a: 350 })).toBe(10);
    expect(computeValue(sub, { a: 10 })).toBe(10);
    expect(computeValue(sub, { a: 180 })).toBe(180);
    expect(computeValue(sub, { a: 0 })).toBe(0);
    expect(computeValue(sub, { a: 360 })).toBe(0);
  });

  it("circular deviation defaults target to 0 when unset", () => {
    const sub = {
      id: "s1",
      inputRule: "circular_deviation" as const,
      sortDirection: "asc" as const,
      inputFields: [{ id: "a", targetValue: null }],
    };
    expect(computeValue(sub, { a: 359 })).toBe(1);
  });

  it("computes absolute difference of two values", () => {
    const sub = {
      id: "s1",
      inputRule: "abs_difference" as const,
      sortDirection: "asc" as const,
      inputFields: [
        { id: "a", targetValue: null },
        { id: "b", targetValue: null },
      ],
    };
    expect(computeValue(sub, { a: 120, b: 115 })).toBe(5);
    expect(computeValue(sub, { a: 100, b: 100 })).toBe(0);
  });
});

describe("rankWithAveragedTies", () => {
  it("ranks ascending", () => {
    const ranks = rankWithAveragedTies(
      [
        { teamId: "A", value: 10 },
        { teamId: "B", value: 20 },
        { teamId: "C", value: 5 },
      ],
      "asc",
    );
    expect(ranks.get("C")).toBe(1);
    expect(ranks.get("A")).toBe(2);
    expect(ranks.get("B")).toBe(3);
  });

  it("averages two-way ties", () => {
    const ranks = rankWithAveragedTies(
      [
        { teamId: "A", value: 10 },
        { teamId: "B", value: 10 },
        { teamId: "C", value: 5 },
        { teamId: "D", value: 20 },
      ],
      "asc",
    );
    expect(ranks.get("C")).toBe(1);
    // A and B tied for 2nd/3rd -> 2.5
    expect(ranks.get("A")).toBe(2.5);
    expect(ranks.get("B")).toBe(2.5);
    expect(ranks.get("D")).toBe(4);
  });

  it("averages three-way ties", () => {
    const ranks = rankWithAveragedTies(
      [
        { teamId: "A", value: 1 },
        { teamId: "B", value: 1 },
        { teamId: "C", value: 1 },
        { teamId: "D", value: 1 },
        { teamId: "E", value: 1 },
        { teamId: "F", value: 1 },
        { teamId: "G", value: 1 },
      ],
      "asc",
    );
    // 7 teams tied -> all rank 4
    for (const t of ["A", "B", "C", "D", "E", "F", "G"]) {
      expect(ranks.get(t)).toBe(4);
    }
  });

  it("ranks descending (heaviest wins)", () => {
    const ranks = rankWithAveragedTies(
      [
        { teamId: "A", value: 100 },
        { teamId: "B", value: 200 },
      ],
      "desc",
    );
    expect(ranks.get("B")).toBe(1);
    expect(ranks.get("A")).toBe(2);
  });
});

describe("rankActivity", () => {
  it("handles single-aggregation activity", () => {
    const activity: ActivityShape = {
      id: "a1",
      aggregationRule: "single",
      subActivities: [
        {
          id: "s1",
          inputRule: "single_value",
          sortDirection: "asc",
          inputFields: [{ id: "f1", targetValue: null }],
        },
      ],
    };
    const scores = [
      { subActivityId: "s1", teamId: "A", computedValue: 30 },
      { subActivityId: "s1", teamId: "B", computedValue: 25 },
      { subActivityId: "s1", teamId: "C", computedValue: 40 },
    ];
    const result = rankActivity(activity, scores, ["A", "B", "C"]);
    expect(result.ranks.get("B")).toBe(1);
    expect(result.ranks.get("A")).toBe(2);
    expect(result.ranks.get("C")).toBe(3);
    expect(result.excluded).toEqual([]);
  });

  it("aggregates sum_of_ranks", () => {
    const activity: ActivityShape = {
      id: "gut",
      aggregationRule: "sum_of_ranks",
      subActivities: [
        {
          id: "s1",
          inputRule: "single_value",
          sortDirection: "asc",
          inputFields: [{ id: "f1", targetValue: null }],
        },
        {
          id: "s2",
          inputRule: "single_value",
          sortDirection: "asc",
          inputFields: [{ id: "f2", targetValue: null }],
        },
      ],
    };
    // s1: A=1st, B=2nd, C=3rd. s2: C=1st, B=2nd, A=3rd.
    // Sums: A=4, B=4, C=4. All tie for 1st -> rank = (1+2+3)/3 = 2.
    const scores = [
      { subActivityId: "s1", teamId: "A", computedValue: 10 },
      { subActivityId: "s1", teamId: "B", computedValue: 20 },
      { subActivityId: "s1", teamId: "C", computedValue: 30 },
      { subActivityId: "s2", teamId: "A", computedValue: 30 },
      { subActivityId: "s2", teamId: "B", computedValue: 20 },
      { subActivityId: "s2", teamId: "C", computedValue: 10 },
    ];
    const result = rankActivity(activity, scores, ["A", "B", "C"]);
    expect(result.ranks.get("A")).toBe(2);
    expect(result.ranks.get("B")).toBe(2);
    expect(result.ranks.get("C")).toBe(2);
  });

  it("excludes teams without full sub-activity coverage", () => {
    const activity: ActivityShape = {
      id: "gut",
      aggregationRule: "sum_of_ranks",
      subActivities: [
        {
          id: "s1",
          inputRule: "single_value",
          sortDirection: "asc",
          inputFields: [{ id: "f1", targetValue: null }],
        },
        {
          id: "s2",
          inputRule: "single_value",
          sortDirection: "asc",
          inputFields: [{ id: "f2", targetValue: null }],
        },
      ],
    };
    // C is missing s2.
    const scores = [
      { subActivityId: "s1", teamId: "A", computedValue: 10 },
      { subActivityId: "s1", teamId: "B", computedValue: 20 },
      { subActivityId: "s1", teamId: "C", computedValue: 30 },
      { subActivityId: "s2", teamId: "A", computedValue: 30 },
      { subActivityId: "s2", teamId: "B", computedValue: 20 },
    ];
    const result = rankActivity(activity, scores, ["A", "B", "C"]);
    expect(result.excluded).toContain("C");
    expect(result.ranks.has("C")).toBe(false);
  });
});

describe("rankActivityLive", () => {
  const gut: ActivityShape = {
    id: "gut",
    aggregationRule: "sum_of_ranks",
    subActivities: [
      { id: "s1", inputRule: "single_value", sortDirection: "asc", inputFields: [{ id: "f1", targetValue: null }] },
      { id: "s2", inputRule: "single_value", sortDirection: "asc", inputFields: [{ id: "f2", targetValue: null }] },
    ],
  };

  it("ranks on partially-measured sub-activities (only one sub logged)", () => {
    // Only s1 submitted for everyone — strict rankActivity would exclude all,
    // but the live ranking should rank them on s1.
    const scores = [
      { subActivityId: "s1", teamId: "A", computedValue: 10 },
      { subActivityId: "s1", teamId: "B", computedValue: 20 },
      { subActivityId: "s1", teamId: "C", computedValue: 30 },
    ];
    const live = rankActivityLive(gut, scores, ["A", "B", "C"]);
    expect(live.ranks.get("A")).toBe(1);
    expect(live.ranks.get("B")).toBe(2);
    expect(live.ranks.get("C")).toBe(3);
    expect(live.noCoverage).toEqual([]);

    // Strict ranking excludes everyone until full coverage.
    const strict = rankActivity(gut, scores, ["A", "B", "C"]);
    expect(strict.ranks.size).toBe(0);
  });

  it("marks teams with no scores as noCoverage", () => {
    const scores = [{ subActivityId: "s1", teamId: "A", computedValue: 10 }];
    const live = rankActivityLive(gut, scores, ["A", "B"]);
    expect(live.ranks.get("A")).toBe(1);
    expect(live.noCoverage).toContain("B");
  });

  it("matches strict ordering once fully measured", () => {
    const scores = [
      { subActivityId: "s1", teamId: "A", computedValue: 10 },
      { subActivityId: "s1", teamId: "B", computedValue: 20 },
      { subActivityId: "s2", teamId: "A", computedValue: 20 },
      { subActivityId: "s2", teamId: "B", computedValue: 10 },
    ];
    const live = rankActivityLive(gut, scores, ["A", "B"]);
    // A: ranks 1 & 2 -> avg 1.5; B: ranks 2 & 1 -> avg 1.5 -> tie.
    expect(live.ranks.get("A")).toBe(1.5);
    expect(live.ranks.get("B")).toBe(1.5);
  });
});

describe("first-place tiebreak", () => {
  it("counts first-place finishes including ties for first", () => {
    const a1 = new Map([["A", 1], ["B", 2], ["C", 3]]);
    const a2 = new Map([["A", 1.5], ["B", 1.5], ["C", 3]]); // A & B share first
    const counts = firstPlaceCounts([a1, a2], ["A", "B", "C"]);
    expect(counts.get("A")).toBe(2);
    expect(counts.get("B")).toBe(1);
    expect(counts.get("C")).toBe(0);
  });

  it("breaks total ties by first-place count", () => {
    const totals = [
      { teamId: "A", value: 10 },
      { teamId: "B", value: 10 },
      { teamId: "C", value: 5 },
    ];
    const firstPlace = new Map([["A", 3], ["B", 1], ["C", 0]]);
    const ranks = rankTotalsWithTiebreak(totals, firstPlace);
    expect(ranks.get("A")).toBe(1);
    expect(ranks.get("B")).toBe(2);
    expect(ranks.get("C")).toBe(3);
  });

  it("shares a rank when totals and first-place counts both tie", () => {
    const totals = [
      { teamId: "A", value: 10 },
      { teamId: "B", value: 10 },
    ];
    const firstPlace = new Map([["A", 2], ["B", 2]]);
    const ranks = rankTotalsWithTiebreak(totals, firstPlace);
    expect(ranks.get("A")).toBe(1.5);
    expect(ranks.get("B")).toBe(1.5);
  });
});

describe("computeLiveStandings", () => {
  it("produces provisional totals and ranks from partial scores", () => {
    const activities: ActivityShape[] = [
      {
        id: "a1",
        aggregationRule: "single",
        subActivities: [
          { id: "s1", inputRule: "single_value", sortDirection: "asc", inputFields: [{ id: "f1", targetValue: null }] },
        ],
      },
    ];
    const scoresByActivity = new Map([
      [
        "a1",
        [
          { subActivityId: "s1", teamId: "A", computedValue: 10 },
          { subActivityId: "s1", teamId: "B", computedValue: 20 },
        ],
      ],
    ]);
    // Team C has no scores yet.
    const live = computeLiveStandings(activities, scoresByActivity, ["A", "B", "C"]);
    // 3 teams: A 1st -> 3 pts, B 2nd -> 2 pts, C none -> 0 pts.
    expect(live.totals.A).toBe(3);
    expect(live.totals.B).toBe(2);
    expect(live.totals.C).toBe(0);
    expect(live.globalRanks.A).toBe(1);
    expect(live.globalRanks.B).toBe(2);
    expect(live.globalRanks.C).toBe(3);
  });
});

describe("pointsForActivity", () => {
  it("converts ranks to (N+1) - rank with 0 for excluded", () => {
    const ranks = new Map<string, number>([
      ["A", 1],
      ["B", 2],
      ["C", 3],
    ]);
    const points = pointsForActivity(ranks, ["D"], 4);
    expect(points.get("A")).toBe(4);
    expect(points.get("B")).toBe(3);
    expect(points.get("C")).toBe(2);
    expect(points.get("D")).toBe(0);
  });

  it("averages points for ties (since ranks are averaged)", () => {
    // 14-team event, two teams tied for 1st -> rank 1.5 each -> points = 14+1-1.5 = 13.5
    const ranks = new Map<string, number>([
      ["A", 1.5],
      ["B", 1.5],
      ["C", 3],
    ]);
    const points = pointsForActivity(ranks, [], 14);
    expect(points.get("A")).toBe(13.5);
    expect(points.get("B")).toBe(13.5);
    expect(points.get("C")).toBe(12);
  });
});

describe("finalize", () => {
  it("produces full snapshot with activity points and global ranks", () => {
    const activities: ActivityShape[] = [
      {
        id: "a1",
        aggregationRule: "single",
        subActivities: [
          {
            id: "s1",
            inputRule: "single_value",
            sortDirection: "asc",
            inputFields: [{ id: "f1", targetValue: null }],
          },
        ],
      },
      {
        id: "a2",
        aggregationRule: "single",
        subActivities: [
          {
            id: "s2",
            inputRule: "single_value",
            sortDirection: "desc",
            inputFields: [{ id: "f2", targetValue: null }],
          },
        ],
      },
    ];
    const scoresByActivity = new Map([
      [
        "a1",
        [
          { subActivityId: "s1", teamId: "A", computedValue: 10 },
          { subActivityId: "s1", teamId: "B", computedValue: 20 },
        ],
      ],
      [
        "a2",
        [
          { subActivityId: "s2", teamId: "A", computedValue: 100 },
          { subActivityId: "s2", teamId: "B", computedValue: 200 },
        ],
      ],
    ]);
    const snap = finalize(activities, scoresByActivity, ["A", "B"]);
    // a1: A 1st (2 pts), B 2nd (1 pt). a2: B 1st (2 pts), A 2nd (1 pt).
    // Totals: A = 3, B = 3 -> tied for 1st -> globalRank 1.5 each.
    expect(snap.totals.A).toBe(3);
    expect(snap.totals.B).toBe(3);
    expect(snap.globalRanks.A).toBe(1.5);
    expect(snap.globalRanks.B).toBe(1.5);
  });
});
