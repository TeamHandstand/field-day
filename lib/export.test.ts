import { describe, expect, it } from "vitest";
import { csvEscape, toCsv, buildExportRows, EXPORT_HEADERS } from "./export";
import type { LeaderboardData } from "./leaderboard";

describe("csvEscape", () => {
  it("leaves plain values untouched", () => {
    expect(csvEscape("Team A")).toBe("Team A");
  });
  it("quotes values with commas", () => {
    expect(csvEscape("Smith, Jane")).toBe('"Smith, Jane"');
  });
  it("doubles embedded quotes", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });
  it("quotes values with newlines", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsv", () => {
  it("joins headers and rows with CRLF", () => {
    const csv = toCsv(["A", "B"], [["1", "2"], ["3", "4"]]);
    expect(csv).toBe("A,B\r\n1,2\r\n3,4");
  });
});

function board(): LeaderboardData {
  return {
    event: { id: "e1", name: "Cabo Cup", isLocked: false, isFinalized: false, finalizedAt: null },
    teams: [
      { id: "t1", name: "Alpha", teamNumber: 1, cohortNumber: 1, photoUrl: null },
      { id: "t2", name: "Beta", teamNumber: 2, cohortNumber: null, photoUrl: null },
    ],
    activities: [
      {
        id: "a1",
        name: "Gut Check",
        aggregationRule: "single",
        description: "",
        subActivities: [
          {
            id: "s1",
            name: "Weight Test",
            inputRule: "abs_deviation_from_target",
            sortDirection: "asc",
            inputFields: [{ id: "f1", label: "Guess", unit: "grams", targetValue: 100 }],
          },
        ],
      },
    ],
    scores: [
      {
        teamId: "t1",
        activityId: "a1",
        subActivityId: "s1",
        computedValue: 10,
        inputs: [{ inputFieldId: "f1", rawValue: 110 }],
      },
    ],
    liveActivityRanks: { a1: { t1: 1 } },
    liveSubActivityRanks: { s1: { t1: 1 } },
    liveStandings: { totals: { t1: 2, t2: 0 }, globalRanks: { t1: 1, t2: 2 } },
    finalized: null,
  };
}

describe("buildExportRows", () => {
  it("emits one row per team/activity/sub-activity/field, including teams with no score", () => {
    const rows = buildExportRows([board()]);
    expect(rows).toHaveLength(2); // 2 teams x 1 sub-activity x 1 field
  });

  it("records value, target and signed deviation for a scored team", () => {
    const rows = buildExportRows([board()]);
    const row = rows[0];
    const col = (name: string) => row[EXPORT_HEADERS.indexOf(name as never)];
    expect(col("Team")).toBe("Alpha");
    expect(col("Recorded Value")).toBe("110");
    expect(col("Target")).toBe("100");
    expect(col("Deviation")).toBe("10"); // 110 - 100
    expect(col("Computed Score")).toBe("10");
    expect(col("Activity Rank")).toBe("1");
    expect(col("Activity Points")).toBe(""); // not finalized yet
    expect(col("Overall Total")).toBe("2");
    expect(col("Overall Rank")).toBe("1");
  });

  it("leaves recorded/target/deviation blank for an unscored team", () => {
    const rows = buildExportRows([board()]);
    const beta = rows.find((r) => r[EXPORT_HEADERS.indexOf("Team" as never)] === "Beta")!;
    const col = (name: string) => beta[EXPORT_HEADERS.indexOf(name as never)];
    expect(col("Recorded Value")).toBe("");
    expect(col("Deviation")).toBe("");
    expect(col("Cohort")).toBe("");
    expect(col("Event Status")).toBe("In progress");
  });
});
