import { z } from "zod";

export const aggregationRule = z.enum(["single", "sum_of_ranks"]);
export const inputRule = z.enum([
  "single_value",
  "sum_of_pct_deviation",
  "abs_deviation_from_target",
]);
export const sortDirection = z.enum(["asc", "desc"]);

export const inputFieldInput = z.object({
  label: z.string().min(1).max(120),
  unit: z.string().min(1).max(40),
  defaultTargetValue: z.number().nullable().optional(),
  targetValue: z.number().nullable().optional(),
});

export const subActivityInput = z.object({
  name: z.string().min(1).max(120),
  inputRule,
  sortDirection,
  inputFields: z.array(inputFieldInput).min(1),
});

export const activityInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(""),
  aggregationRule,
  subActivities: z.array(subActivityInput).min(1),
});
