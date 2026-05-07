// Pure scoring engine. No DB or framework imports here — everything in/out is plain data.

export type InputRule = "single_value" | "sum_of_pct_deviation" | "abs_deviation_from_target";
export type SortDirection = "asc" | "desc";
export type AggregationRule = "single" | "sum_of_ranks";

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

export function finalize(
  activities: ActivityShape[],
  scoresByActivity: Map<string /* activityId */, SubActivityScore[]>,
  allTeamIds: string[],
): FinalizedSnapshot {
  const N = allTeamIds.length;
  const finalActivities: FinalizedActivitySnapshot[] = [];
  const totals: Record<string, number> = Object.fromEntries(allTeamIds.map((t) => [t, 0]));

  for (const activity of activities) {
    const scores = scoresByActivity.get(activity.id) ?? [];
    const { ranks, excluded, subActivityRanks } = rankActivity(activity, scores, allTeamIds);
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

  // Global ranks: highest total = 1st.
  const totalsList = Object.entries(totals).map(([teamId, value]) => ({ teamId, value }));
  const globalRankMap = rankWithAveragedTies(totalsList, "desc");
  const globalRanks: Record<string, number> = Object.fromEntries(globalRankMap);

  return {
    finalizedAt: new Date().toISOString(),
    totalTeams: N,
    activities: finalActivities,
    totals,
    globalRanks,
  };
}
