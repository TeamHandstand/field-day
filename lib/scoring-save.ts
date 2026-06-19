import type { Prisma } from "@prisma/client";
import { computeValue, type InputRule, type SortDirection } from "./scoring";

export type SubWithFields = {
  id: string;
  name: string;
  inputRule: InputRule;
  sortDirection: SortDirection;
  inputFields: { id: string; label: string; targetValue: number | null }[];
};

// Validates a single sub-activity's raw inputs against the same rules the
// per-team POST /api/scores endpoint has always enforced, then returns the
// computed score. Throws an Error with a host-readable message on any problem.
export function validateAndComputeSub(
  sub: SubWithFields,
  raws: Record<string, number>,
): number {
  for (const f of sub.inputFields) {
    if (typeof raws[f.id] !== "number" || !Number.isFinite(raws[f.id])) {
      throw new Error(`Missing input ${f.label}`);
    }
  }
  if (sub.inputRule === "sum_of_pct_deviation") {
    for (const f of sub.inputFields) {
      if (f.targetValue == null || f.targetValue === 0) {
        throw new Error(`Sub-activity "${sub.name}" needs non-zero targets`);
      }
    }
  }
  if (sub.inputRule === "abs_deviation_from_target") {
    for (const f of sub.inputFields) {
      if (f.targetValue == null) throw new Error(`"${sub.name}" needs a target`);
    }
  }
  return computeValue(
    {
      id: sub.id,
      inputRule: sub.inputRule,
      sortDirection: sub.sortDirection,
      inputFields: sub.inputFields.map((f) => ({ id: f.id, targetValue: f.targetValue })),
    },
    raws,
  );
}

export type PersistSubResult = {
  scoreEntryId: string;
  computedValue: number;
  priorComputedValue: number | null;
  isUpdate: boolean;
};

// Upserts the ScoreEntry for one (team, subActivity) and replaces its inputs.
// Caller is responsible for running inside a transaction and for auditing.
export async function persistSubScore(
  tx: Prisma.TransactionClient,
  args: {
    teamId: string;
    sub: SubWithFields;
    raws: Record<string, number>;
    adminId: string;
    computed: number;
  },
): Promise<PersistSubResult> {
  const { teamId, sub, raws, adminId, computed } = args;
  const prior = await tx.scoreEntry.findUnique({
    where: { teamId_subActivityId: { teamId, subActivityId: sub.id } },
  });
  const saved = await tx.scoreEntry.upsert({
    where: { teamId_subActivityId: { teamId, subActivityId: sub.id } },
    create: {
      teamId,
      subActivityId: sub.id,
      computedValue: computed,
      createdByAdminId: adminId,
    },
    update: { computedValue: computed },
  });
  await tx.scoreInput.deleteMany({ where: { scoreEntryId: saved.id } });
  await tx.scoreInput.createMany({
    data: sub.inputFields.map((f) => ({
      scoreEntryId: saved.id,
      inputFieldId: f.id,
      rawValue: raws[f.id],
    })),
  });
  return {
    scoreEntryId: saved.id,
    computedValue: computed,
    priorComputedValue: prior?.computedValue ?? null,
    isUpdate: !!prior,
  };
}
