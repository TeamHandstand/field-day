// End-to-end scoring SCENARIO test.
//
// This mirrors, exactly, the manual QA plan in testing/TEST-PLAN.md:
// 6 teams, the 4 system-seeded activity templates, a fixed set of raw inputs
// (including ties and two deliberate coverage gaps), run through the real
// scoring engine. The asserted numbers here ARE the ground-truth values the
// manual plan tells a human tester to expect on the leaderboard.
//
// If this test and the plan ever disagree, the engine (this test) is correct.
// Run `npx vitest run lib/scenario.test.ts` and read the printed report.

import { describe, expect, it } from "vitest";
import {
  computeValue,
  finalize,
  type ActivityShape,
  type SubActivityScore,
} from "./scoring";

// ---- Teams -----------------------------------------------------------------
const TEAMS = ["T1", "T2", "T3", "T4", "T5", "T6"]; // teamNumber 1..6
const N = TEAMS.length; // 6 -> 1st = 6 pts, last = 1 pt

// ---- Field ids (stable, readable) ------------------------------------------
// Activity 1: Cross the Ocean (single / single_value / asc / seconds)
const OCEAN: ActivityShape = {
  id: "ocean",
  aggregationRule: "single",
  subActivities: [
    { id: "ocean.run", inputRule: "single_value", sortDirection: "asc", inputFields: [{ id: "ocean.time", targetValue: null }] },
  ],
};
// Activity 2: Team Slingshot (single / single_value / asc / seconds)
const SLING: ActivityShape = {
  id: "sling",
  aggregationRule: "single",
  subActivities: [
    { id: "sling.run", inputRule: "single_value", sortDirection: "asc", inputFields: [{ id: "sling.time", targetValue: null }] },
  ],
};
// Activity 3: Splash Zone (single / single_value / desc / grams)
const SPLASH: ActivityShape = {
  id: "splash",
  aggregationRule: "single",
  subActivities: [
    { id: "splash.weigh", inputRule: "single_value", sortDirection: "desc", inputFields: [{ id: "splash.weight", targetValue: null }] },
  ],
};
// Activity 4: Gut Check (sum_of_ranks composite of 4 sub-activities, all asc)
// Timer targets come from template defaults (30/60/90).
// Weight targets set by admin to 100/200/300; Measurement to 50/100/150.
const GUT: ActivityShape = {
  id: "gut",
  aggregationRule: "sum_of_ranks",
  subActivities: [
    { id: "gut.north", inputRule: "single_value", sortDirection: "asc", inputFields: [{ id: "gut.north.deg", targetValue: null }] },
    {
      id: "gut.timer", inputRule: "sum_of_pct_deviation", sortDirection: "asc",
      inputFields: [
        { id: "gut.timer.1", targetValue: 30 },
        { id: "gut.timer.2", targetValue: 60 },
        { id: "gut.timer.3", targetValue: 90 },
      ],
    },
    {
      id: "gut.weight", inputRule: "sum_of_pct_deviation", sortDirection: "asc",
      inputFields: [
        { id: "gut.weight.1", targetValue: 100 },
        { id: "gut.weight.2", targetValue: 200 },
        { id: "gut.weight.3", targetValue: 300 },
      ],
    },
    {
      id: "gut.meas", inputRule: "sum_of_pct_deviation", sortDirection: "asc",
      inputFields: [
        { id: "gut.meas.1", targetValue: 50 },
        { id: "gut.meas.2", targetValue: 100 },
        { id: "gut.meas.3", targetValue: 150 },
      ],
    },
  ],
};

const ACTIVITIES = [OCEAN, SLING, SPLASH, GUT];

// ---- Raw inputs (what a tester types into the score form) ------------------
// `undefined` = no score entered for that team (coverage gap).
const RAW: Record<string, Record<string, number | undefined>> = {
  // Cross the Ocean: T1 & T3 tie (45); T6 has no score -> excluded.
  "ocean.time":   { T1: 45, T2: 50, T3: 45, T4: 60, T5: 55, T6: undefined },
  // Team Slingshot: full coverage, no ties.
  "sling.time":   { T1: 30, T2: 20, T3: 40, T4: 35, T5: 25, T6: 50 },
  // Splash Zone (desc, heaviest wins): T2 & T3 tie (1500).
  "splash.weight":{ T1: 1000, T2: 1500, T3: 1500, T4: 800, T5: 1200, T6: 900 },
  // Gut Check — Point North (asc, lower = better):
  "gut.north.deg":{ T1: 10, T2: 5, T3: 20, T4: 15, T5: 25, T6: 8 },
  // Timer Test (targets 30/60/90):
  "gut.timer.1":  { T1: 30, T2: 33, T3: 36, T4: 39, T5: 30, T6: 33 },
  "gut.timer.2":  { T1: 60, T2: 66, T3: 72, T4: 78, T5: 60, T6: 60 },
  "gut.timer.3":  { T1: 90, T2: 99, T3: 108, T4: 117, T5: 99, T6: 99 },
  // Weight Test (targets 100/200/300):
  "gut.weight.1": { T1: 100, T2: 110, T3: 100, T4: 110, T5: 100, T6: 110 },
  "gut.weight.2": { T1: 200, T2: 220, T3: 220, T4: 200, T5: 200, T6: 200 },
  "gut.weight.3": { T1: 300, T2: 330, T3: 300, T4: 300, T5: 330, T6: 300 },
  // Measurement Test (targets 50/100/150). T6 has NO measurement scores -> excluded from Gut Check.
  "gut.meas.1":   { T1: 50, T2: 55, T3: 50, T4: 55, T5: 50, T6: undefined },
  "gut.meas.2":   { T1: 100, T2: 110, T3: 105, T4: 100, T5: 100, T6: undefined },
  "gut.meas.3":   { T1: 150, T2: 165, T3: 150, T4: 150, T5: 160, T6: undefined },
};

// Build computed scores per activity by running the real computeValue.
function buildScores(): Map<string, SubActivityScore[]> {
  const byActivity = new Map<string, SubActivityScore[]>();
  for (const activity of ACTIVITIES) {
    const list: SubActivityScore[] = [];
    for (const sub of activity.subActivities) {
      for (const team of TEAMS) {
        // Gather this team's raws for this sub-activity's fields.
        const raws: Record<string, number> = {};
        let complete = true;
        for (const f of sub.inputFields) {
          const v = RAW[f.id]?.[team];
          if (typeof v !== "number") { complete = false; break; }
          raws[f.id] = v;
        }
        if (!complete) continue; // team didn't submit this sub-activity
        const computed = computeValue(sub, raws);
        list.push({ subActivityId: sub.id, teamId: team, computedValue: computed });
      }
    }
    byActivity.set(activity.id, list);
  }
  return byActivity;
}

describe("QA scenario — 6 teams, 4 seeded templates", () => {
  const scores = buildScores();
  const snap = finalize(ACTIVITIES, scores, TEAMS);

  it("prints the full ground-truth report", () => {
    const lines: string[] = [];
    lines.push(`\n===== GROUND TRUTH (N=${N}) =====`);
    for (const a of ACTIVITIES) {
      const fa = snap.activities.find((x) => x.activityId === a.id)!;
      lines.push(`\n# ${a.id} (${a.aggregationRule})`);
      for (const t of TEAMS) {
        const rank = fa.activityRanks[t];
        const pts = fa.points[t];
        const excl = fa.excluded.includes(t);
        lines.push(`  ${t}: rank=${rank ?? "—"}  points=${pts}${excl ? "  [EXCLUDED]" : ""}`);
      }
    }
    lines.push(`\n# OVERALL`);
    for (const t of TEAMS) {
      lines.push(`  ${t}: total=${snap.totals[t]}  globalRank=${snap.globalRanks[t]}`);
    }
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(snap.totalTeams).toBe(N);
  });

  // ---- Locked-in assertions (engine-verified) -----------------------------
  it("Cross the Ocean: T1/T3 tie 1st, T6 excluded", () => {
    const a = snap.activities.find((x) => x.activityId === "ocean")!;
    expect(a.activityRanks.T1).toBe(1.5);
    expect(a.activityRanks.T3).toBe(1.5);
    expect(a.activityRanks.T2).toBe(3);
    expect(a.activityRanks.T5).toBe(4);
    expect(a.activityRanks.T4).toBe(5);
    expect(a.excluded).toContain("T6");
    expect(a.points.T1).toBe(5.5);
    expect(a.points.T3).toBe(5.5);
    expect(a.points.T6).toBe(0);
  });

  it("Splash Zone: desc, T2/T3 tie 1st (heaviest)", () => {
    const a = snap.activities.find((x) => x.activityId === "splash")!;
    expect(a.activityRanks.T2).toBe(1.5);
    expect(a.activityRanks.T3).toBe(1.5);
    expect(a.activityRanks.T5).toBe(3);
    expect(a.points.T2).toBe(5.5);
    expect(a.points.T4).toBe(1); // lightest -> last
  });

  it("Gut Check: sum_of_ranks, T6 excluded (missing Measurement)", () => {
    const a = snap.activities.find((x) => x.activityId === "gut")!;
    expect(a.excluded).toContain("T6");
    expect(a.points.T6).toBe(0);
  });
});
