// Auto-generated plain-language explanations for activities and sub-activities.
// Pure functions. Both return Markdown strings.

import type { AggregationRule, InputRule, SortDirection } from "./scoring";

type SubActivityForExplain = {
  name: string;
  inputRule: InputRule;
  sortDirection: SortDirection;
  inputFields: { label: string; unit: string; targetValue: number | null }[];
};

type ActivityForExplain = {
  name: string;
  aggregationRule: AggregationRule;
  subActivities: SubActivityForExplain[];
};

function pointsTail(N: number): string {
  return `With ${N} teams, **1st earns ${N} points** and **last earns 1 point**. Ties split points evenly.`;
}

export function explainSubActivity(sub: SubActivityForExplain): string {
  const direction = sub.sortDirection === "asc" ? "Lower" : "Higher";
  switch (sub.inputRule) {
    case "single_value": {
      const f = sub.inputFields[0];
      const unit = f?.unit ?? "value";
      return `Each team submits one ${unit} for **${sub.name}**. ${direction} = better.`;
    }
    case "sum_of_pct_deviation": {
      const targets = sub.inputFields
        .map((f) => (f.targetValue == null ? "?" : f.targetValue.toString()))
        .join(", ");
      const unit = sub.inputFields[0]?.unit ?? "value";
      return `**${sub.name}** has ${sub.inputFields.length} attempts in ${unit} with targets ${targets}. For each attempt we calculate how far off the target you were as a percentage. The percentages are added — lowest total is best.`;
    }
    case "abs_deviation_from_target": {
      const f = sub.inputFields[0];
      const target = f?.targetValue == null ? "the target" : f.targetValue.toString();
      const unit = f?.unit ?? "value";
      return `**${sub.name}** scores how far the submitted ${unit} is from ${target}. Closest to target is best.`;
    }
    case "circular_deviation": {
      const f = sub.inputFields[0];
      const unit = f?.unit ?? "degrees";
      const target = f?.targetValue ?? 0;
      const heading = target === 0 ? "North (0°)" : `${target}°`;
      return `Each team submits a ${unit} bearing for **${sub.name}**. We score how far it is from ${heading}, wrapping around 360° (so 350° counts as 10° off). Closest is best.`;
    }
    case "abs_difference": {
      const a = sub.inputFields[0]?.label ?? "the first value";
      const b = sub.inputFields[1]?.label ?? "the second value";
      const unit = sub.inputFields[0]?.unit ?? "value";
      return `**${sub.name}** takes two ${unit} values (${a} and ${b}) that should match. The score is the gap between them — the closer, the better.`;
    }
  }
}

export function explainActivity(activity: ActivityForExplain, eventTeamCount: number): string {
  const N = Math.max(eventTeamCount, 1);
  if (activity.aggregationRule === "single") {
    const sub = activity.subActivities[0];
    if (!sub) return `**${activity.name}** has no sub-activities yet.`;
    const f = sub.inputFields[0];
    const unit = f?.unit ?? "value";
    if (sub.inputRule === "single_value") {
      const direction = sub.sortDirection === "asc" ? "Lowest" : "Highest";
      return `Each team submits one ${unit} for **${activity.name}**. ${direction} places **1st**. ${pointsTail(N)}`;
    }
    return `**${activity.name}** scores teams using its sub-activity rules. ${pointsTail(N)}`;
  }
  // sum_of_ranks
  const subNames = activity.subActivities.map((s) => s.name).join(", ");
  return `**${activity.name}** is a composite challenge with ${activity.subActivities.length} sub-tests: ${subNames}. Each team is ranked **1st–${N}th** in each sub-test, and those ranks are added together. The team with the **lowest total places 1st**. ${pointsTail(N)}`;
}
