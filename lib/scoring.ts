// Pure scoring engine. No DB or framework imports here — everything in/out is plain data.

export type InputRule =
  | "single_value"
  | "sum_of_pct_deviation"
  | "abs_deviation_from_target"
  | "circular_deviation"
  | "abs_difference";
export type SortDirection = "asc" | "desc";
export type AggregationRule = "single" | "sum_of_ranks";

// Deviation rules where a host must enter a target before scores can be logged.
// circular_deviation defaults its target to 0 (North), so it isn't included.
export function ruleRequiresTarget(rule: InputRule): boolean {
  return rule === "sum_of_pct_deviation" || rule === "abs_deviation_from_target";
}

export type InputFieldShape = {
  id: string;
  targetValue: number | null;
};

export type SubActivityShape = {
  id: string;
  inputRule: InputRule;
  sortDirection: SortDirection;
  inputFields: InputFieldShape[];
};

export type ActivityShape = {
  id: string;
  aggregationRule: AggregationRule;
  subActivities: SubActivityShape[];
};

export type RawInputs = Record<string /* inputFieldId */, number>;

// 6.1 — raw inputs -> one computed value per sub-activity.
export function computeValue(subActivity: SubActivityShape, raws: RawInputs): number {
  const fields = subActivity.inputFields;
  switch (subActivity.inputRule) {
    case "single_value": {
      if (fields.length !== 1) {
        throw new Error("single_value requires exactly one input field");
      }
      const v = raws[fields[0].id];
      if (typeof v !== "number" || Number.isNaN(v)) {
        throw new Error("Missing input value for single_value sub-activity");
      }
      return v;
    }
    case "sum_of_pct_deviation": {
      let total = 0;
      for (const f of fields) {
        const raw = raws[f.id];
        if (typeof raw !== "number" || Number.isNaN(raw)) {
          throw new Error("Missing input value");
        }
        if (f.targetValue == null || f.targetValue === 0) {
          throw new Error("sum_of_pct_deviation requires non-zero target on every field");
        }
        total += (Math.abs(raw - f.targetValue) / Math.abs(f.targetValue)) * 100;
      }
      return total;
    }
    case "abs_deviation_from_target": {
      if (fields.length !== 1) {
        throw new Error("abs_deviation_from_target requires exactly one input field");
      }
      const f = fields[0];
      const raw = raws[f.id];
      if (typeof raw !== "number" || Number.isNaN(raw)) {
        throw new Error("Missing input value");
      }
      if (f.targetValue == null) {
        throw new Error("abs_deviation_from_target requires a target");
      }
      return Math.abs(raw - f.targetValue);
    }
    case "circular_deviation": {
      // Compass-style offset from a target heading (default North = 0°), wrapping
      // around 360. A bearing of 350° is only 10° off North, not 350°.
      if (fields.length !== 1) {
        throw new Error("circular_deviation requires exactly one input field");
      }
      const f = fields[0];
      const raw = raws[f.id];
      if (typeof raw !== "number" || Number.isNaN(raw)) {
        throw new Error("Missing input value");
      }
      const target = f.targetValue ?? 0;
      let d = Math.abs(raw - target) % 360;
      if (d > 180) d = 360 - d;
      return d;
    }
    case "abs_difference": {
      // Two values that should be identical (e.g. the two halves of a banana).
      // Score is the absolute gap between them — lower is better.
      if (fields.length !== 2) {
        throw new Error("abs_difference requires exactly two input fields");
      }
      const a = raws[fields[0].id];
      const b = raws[fields[1].id];
      if (typeof a !== "number" || Number.isNaN(a) || typeof b !== "number" || Number.isNaN(b)) {
        throw new Error("Missing input value");
      }
      return Math.abs(a - b);
    }
  }
}

// 6.2 — averaged ranks within a sub-activity.
// Returns map of teamId -> rank. Teams not present are excluded.
export function rankWithAveragedTies(
  values: { teamId: string; value: number }[],
  sort: SortDirection,
): Map<string, number> {
  if (values.length === 0) return new Map();
  const cmp = (a: number, b: number) => (sort === "asc" ? a - b : b - a);
  const sorted = [...values].sort((a, b) => cmp(a.value, b.value));
  const out = new Map<string, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j++;
    // Tied positions are i..j (zero-indexed). Average rank = ((i+1) + (j+1)) / 2.
    const avg = ((i + 1) + (j + 1)) / 2;
    for (let k = i; k <= j; k++) {
      out.set(sorted[k].teamId, avg);
    }
    i = j + 1;
  }
  return out;
}

// 6.3 — aggregate sub-activity ranks into an activity rank.
// Teams missing any sub-activity score are excluded.
export type SubActivityScore = {
  subActivityId: string;
  teamId: string;
  computedValue: number;
};

export function rankActivity(
  activity: ActivityShape,
  scores: SubActivityScore[],
  allTeamIds: string[],
): {
  ranks: Map<string, number>; // teamId -> activity rank
  excluded: string[]; // teamIds that didn't have full coverage
  subActivityRanks: Map<string /* subActivityId */, Map<string, number>>; // teamId -> sub rank
} {
  const subRanks = new Map<string, Map<string, number>>();
  // Group scores by sub-activity.
  const bySub = new Map<string, SubActivityScore[]>();
  for (const s of scores) {
    if (!bySub.has(s.subActivityId)) bySub.set(s.subActivityId, []);
    bySub.get(s.subActivityId)!.push(s);
  }

  for (const sub of activity.subActivities) {
    const list = bySub.get(sub.id) ?? [];
    subRanks.set(
      sub.id,
      rankWithAveragedTies(
        list.map((s) => ({ teamId: s.teamId, value: s.computedValue })),
        sub.sortDirection,
      ),
    );
  }

  // Teams with full coverage across every sub-activity participate.
  const requiredSubs = activity.subActivities.map((s) => s.id);
  const eligible = new Set<string>();
  for (const t of allTeamIds) {
    if (requiredSubs.every((sid) => subRanks.get(sid)?.has(t))) eligible.add(t);
  }
  const excluded = allTeamIds.filter((t) => !eligible.has(t));

  if (activity.aggregationRule === "single") {
    // Activity rank == its single sub-activity's rank.
    const onlySub = activity.subActivities[0];
    const map = new Map<string, number>();
    if (onlySub) {
      const sr = subRanks.get(onlySub.id) ?? new Map();
      for (const t of eligible) {
        if (sr.has(t)) map.set(t, sr.get(t)!);
      }
    }
    return { ranks: map, excluded, subActivityRanks: subRanks };
  }

  // sum_of_ranks: sum a team's sub ranks, then re-rank ascending with averaged ties.
  const sums: { teamId: string; value: number }[] = [];
  for (const t of eligible) {
    let total = 0;
    for (const sid of requiredSubs) {
      total += subRanks.get(sid)!.get(t)!;
    }
    sums.push({ teamId: t, value: total });
  }
  const ranks = rankWithAveragedTies(sums, "asc");
  return { ranks, excluded, subActivityRanks: subRanks };
}

// 6.3b — LIVE (provisional) activity ranking used while an event is still being
// measured. Unlike rankActivity, it does not require full sub-activity coverage:
// a team is ranked on whatever sub-activities it has completed so far. For
// sum_of_ranks we use the AVERAGE of completed sub-ranks (rather than the sum) so
// teams aren't penalized for simply having more sub-activities measured. Once every
// sub-activity is in, the average produces the same ordering as finalization's sum.
export function rankActivityLive(
  activity: ActivityShape,
  scores: SubActivityScore[],
  allTeamIds: string[],
): {
  ranks: Map<string, number>; // teamId -> provisional activity rank
  noCoverage: string[]; // teamIds with no score in any sub-activity yet
  subActivityRanks: Map<string, Map<string, number>>;
} {
  const subRanks = new Map<string, Map<string, number>>();
  const bySub = new Map<string, SubActivityScore[]>();
  for (const s of scores) {
    if (!bySub.has(s.subActivityId)) bySub.set(s.subActivityId, []);
    bySub.get(s.subActivityId)!.push(s);
  }
  for (const sub of activity.subActivities) {
    const list = bySub.get(sub.id) ?? [];
    subRanks.set(
      sub.id,
      rankWithAveragedTies(
        list.map((s) => ({ teamId: s.teamId, value: s.computedValue })),
        sub.sortDirection,
      ),
    );
  }

  // A team has "coverage" if it appears in at least one sub-activity.
  const covered = new Set<string>();
  for (const t of allTeamIds) {
    if (activity.subActivities.some((s) => subRanks.get(s.id)?.has(t))) covered.add(t);
  }
  const noCoverage = allTeamIds.filter((t) => !covered.has(t));

  if (activity.aggregationRule === "single") {
    const onlySub = activity.subActivities[0];
    const map = new Map<string, number>();
    if (onlySub) {
      const sr = subRanks.get(onlySub.id) ?? new Map();
      for (const t of covered) if (sr.has(t)) map.set(t, sr.get(t)!);
    }
    return { ranks: map, noCoverage, subActivityRanks: subRanks };
  }

  // sum_of_ranks: average the sub-ranks a team has completed, then re-rank ascending.
  const averages: { teamId: string; value: number }[] = [];
  for (const t of covered) {
    let total = 0;
    let count = 0;
    for (const sub of activity.subActivities) {
      const r = subRanks.get(sub.id)?.get(t);
      if (r != null) {
        total += r;
        count++;
      }
    }
    if (count > 0) averages.push({ teamId: t, value: total / count });
  }
  const ranks = rankWithAveragedTies(averages, "asc");
  return { ranks, noCoverage, subActivityRanks: subRanks };
}

// Count, per team, how many activities they finished first in (or tied for first).
// "First" = their rank equals the best (minimum) rank awarded in that activity.
export function firstPlaceCounts(
  activityRankMaps: Map<string, number>[],
  allTeamIds: string[],
): Map<string, number> {
  const counts = new Map<string, number>(allTeamIds.map((t) => [t, 0]));
  for (const ranks of activityRankMaps) {
    if (ranks.size === 0) continue;
    let min = Infinity;
    for (const r of ranks.values()) if (r < min) min = r;
    for (const [teamId, r] of ranks) {
      if (r === min) counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
    }
  }
  return counts;
}

// Rank teams by total points (highest first). Ties on total are broken by the
// number of first-place finishes (more = better). Teams equal on BOTH share an
// averaged rank.
export function rankTotalsWithTiebreak(
  totals: { teamId: string; value: number }[],
  firstPlace: Map<string, number>,
): Map<string, number> {
  if (totals.length === 0) return new Map();
  const fp = (id: string) => firstPlace.get(id) ?? 0;
  const sorted = [...totals].sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    return fp(b.teamId) - fp(a.teamId);
  });
  const sameRank = (x: { teamId: string; value: number }, y: { teamId: string; value: number }) =>
    x.value === y.value && fp(x.teamId) === fp(y.teamId);
  const out = new Map<string, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sameRank(sorted[i], sorted[j + 1])) j++;
    const avg = ((i + 1) + (j + 1)) / 2;
    for (let k = i; k <= j; k++) out.set(sorted[k].teamId, avg);
    i = j + 1;
  }
  return out;
}

// 6.4 — points = (N+1) - rank, with averaged points for ties (same as averaging ranks).
// Excluded teams earn 0 for this activity.
export function pointsForActivity(
  activityRanks: Map<string, number>,
  excluded: string[],
  totalTeams: number,
): Map<string, number> {
  const points = new Map<string, number>();
  for (const [teamId, rank] of activityRanks) {
    points.set(teamId, totalTeams + 1 - rank);
  }
  for (const teamId of excluded) {
    points.set(teamId, 0);
  }
  return points;
}

// 6.5 — finalization snapshot.
export type FinalizedActivitySnapshot = {
  activityId: string;
  subActivityRanks: Record<string, Record<string, number>>; // subId -> teamId -> rank
  activityRanks: Record<string, number>; // teamId -> rank
  excluded: string[]; // teamIds excluded from this activity
  points: Record<string, number>; // teamId -> points
};

export type FinalizedSnapshot = {
  finalizedAt: string;
  totalTeams: number;
  activities: FinalizedActivitySnapshot[];
  totals: Record<string, number>; // teamId -> sum of points
  globalRanks: Record<string, number>; // teamId -> overall rank
};

// Provisional overall standings while the event is live. Mirrors finalize()'s
// point logic but uses rankActivityLive so partially-measured activities still
// contribute, letting the leaderboard update as scores are logged.
export function computeLiveStandings(
  activities: ActivityShape[],
  scoresByActivity: Map<string, SubActivityScore[]>,
  allTeamIds: string[],
): { totals: Record<string, number>; globalRanks: Record<string, number> } {
  const N = allTeamIds.length;
  const totals: Record<string, number> = Object.fromEntries(allTeamIds.map((t) => [t, 0]));
  const activityRankMaps: Map<string, number>[] = [];
  for (const activity of activities) {
    const scores = scoresByActivity.get(activity.id) ?? [];
    const { ranks, noCoverage } = rankActivityLive(activity, scores, allTeamIds);
    activityRankMaps.push(ranks);
    const points = pointsForActivity(ranks, noCoverage, N);
    for (const [t, p] of points) totals[t] = (totals[t] ?? 0) + p;
  }
  const totalsList = Object.entries(totals).map(([teamId, value]) => ({ teamId, value }));
  const firstPlace = firstPlaceCounts(activityRankMaps, allTeamIds);
  const globalRanks = Object.fromEntries(rankTotalsWithTiebreak(totalsList, firstPlace));
  return { totals, globalRanks };
}

export function finalize(
  activities: ActivityShape[],
  scoresByActivity: Map<string /* activityId */, SubActivityScore[]>,
  allTeamIds: string[],
): FinalizedSnapshot {
  const N = allTeamIds.length;
  const finalActivities: FinalizedActivitySnapshot[] = [];
  const totals: Record<string, number> = Object.fromEntries(allTeamIds.map((t) => [t, 0]));
  const activityRankMaps: Map<string, number>[] = [];

  for (const activity of activities) {
    const scores = scoresByActivity.get(activity.id) ?? [];
    const { ranks, excluded, subActivityRanks } = rankActivity(activity, scores, allTeamIds);
    activityRankMaps.push(ranks);
    const points = pointsForActivity(ranks, excluded, N);
    for (const [t, p] of points) totals[t] = (totals[t] ?? 0) + p;

    const subActivityRanksObj: Record<string, Record<string, number>> = {};
    for (const [sid, m] of subActivityRanks) {
      subActivityRanksObj[sid] = Object.fromEntries(m);
    }
    finalActivities.push({
      activityId: activity.id,
      subActivityRanks: subActivityRanksObj,
      activityRanks: Object.fromEntries(ranks),
      excluded,
      points: Object.fromEntries(points),
    });
  }

  // Global ranks: highest total = 1st. Ties broken by most first-place finishes.
  const totalsList = Object.entries(totals).map(([teamId, value]) => ({ teamId, value }));
  const firstPlace = firstPlaceCounts(activityRankMaps, allTeamIds);
  const globalRankMap = rankTotalsWithTiebreak(totalsList, firstPlace);
  const globalRanks: Record<string, number> = Object.fromEntries(globalRankMap);

  return {
    finalizedAt: new Date().toISOString(),
    totalTeams: N,
    activities: finalActivities,
    totals,
    globalRanks,
  };
}
