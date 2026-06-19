# Batch Score-Logging by Sub-Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second score-logging layout — enter every team's value for one sub-activity and save all at once — selectable via a persistent toggle on every activity's `/log` page.

**Architecture:** Extract the per-sub-activity validate/compute/persist logic out of `POST /api/scores` into a shared helper (`lib/scoring-save.ts`). Add a new `POST /api/scores/batch` endpoint that uses it to save one sub-activity across many teams in one transaction. On the frontend, add a `localStorage`-backed view toggle to the log page that switches between the existing per-team modal flow and a new `BatchScoreView` component.

**Tech Stack:** Next.js 14 (App Router, client components), React 18, Prisma 5, Zod, Vitest, Tailwind, PubNub.

## Global Constraints

- TypeScript strict; match existing file style (2-space indent, double quotes, named exports).
- Reuse existing helpers: `requireAdmin`, `badRequest`, `notFound` (`lib/api.ts`); `computeValue` (`lib/scoring.ts`); `audit` (`lib/audit.ts`); `publishEvent` (`lib/pubnub-server.ts`); `TimeInput` / `shouldUseTimeInput` (`components/TimeInput.tsx`).
- Validation rules for a sub-activity (verbatim from current `POST /api/scores`): every input field must be a finite number; `sum_of_pct_deviation` requires every `targetValue` non-null and non-zero; `abs_deviation_from_target` requires every `targetValue` non-null.
- Event lock: reject writes when `team.event.isLocked`.
- Audit one entry per saved `(team, subActivity)`; publish exactly one `score_updated` event per request.
- Tests run with `npm test` (vitest). Only `lib/*.test.ts` unit tests exist today — follow that pattern; do not add a test runner for API routes.

---

### Task 1: Extract shared sub-activity save helper

Pull the validate→compute and the persist (upsert + replace inputs) logic out of `POST /api/scores` into a reusable, unit-tested module, then refactor the existing endpoint to use it. No behavior change.

**Files:**
- Create: `lib/scoring-save.ts`
- Create: `lib/scoring-save.test.ts`
- Modify: `app/api/scores/route.ts` (replace the inline per-sub block inside the transaction)

**Interfaces:**
- Consumes: `computeValue` from `lib/scoring.ts`; `Prisma` from `@prisma/client`.
- Produces:
  - `type SubWithFields = { id: string; name: string; inputRule: InputRule; sortDirection: SortDirection; inputFields: { id: string; label: string; targetValue: number | null }[] }`
  - `validateAndComputeSub(sub: SubWithFields, raws: Record<string, number>): number` — throws `Error` with host-readable message on invalid input; returns computed value.
  - `persistSubScore(tx, { teamId, sub, raws, adminId, computed }): Promise<{ scoreEntryId: string; computedValue: number; priorComputedValue: number | null; isUpdate: boolean }>`

- [ ] **Step 1: Write the failing test**

Create `lib/scoring-save.test.ts`:

```ts
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
    // |30-30|/30 + |90-60|/60 = 0 + 0.5 = 0.5
    expect(validateAndComputeSub(pct, { a: 30, b: 90 })).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- scoring-save`
Expected: FAIL — `Cannot find module './scoring-save'`.

- [ ] **Step 3: Write the helper**

Create `lib/scoring-save.ts`:

```ts
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
```

Note: confirm `InputRule` and `SortDirection` are exported from `lib/scoring.ts` (they are, per the type list). If not, inline the union types instead of importing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- scoring-save`
Expected: PASS (5 tests).

- [ ] **Step 5: Refactor `POST /api/scores` to use the helper**

In `app/api/scores/route.ts`, inside the `prisma.$transaction` loop, replace the inline validation, `computeValue`, `findUnique`/`upsert`/`deleteMany`/`createMany` block with calls to the helper. The loop body becomes:

```ts
for (const entry of subEntries) {
  const sub = subById.get(entry.subActivityId);
  if (!sub) throw new Error("Sub-activity does not belong to activity");

  const computed = validateAndComputeSub(
    {
      id: sub.id,
      name: sub.name,
      inputRule: sub.inputRule,
      sortDirection: sub.sortDirection,
      inputFields: sub.inputFields.map((f) => ({
        id: f.id,
        label: f.label,
        targetValue: f.targetValue,
      })),
    },
    entry.raws,
  );

  const result = await persistSubScore(tx, {
    teamId,
    sub: {
      id: sub.id,
      name: sub.name,
      inputRule: sub.inputRule,
      sortDirection: sub.sortDirection,
      inputFields: sub.inputFields.map((f) => ({
        id: f.id,
        label: f.label,
        targetValue: f.targetValue,
      })),
    },
    raws: entry.raws,
    adminId: auth.adminId,
    computed,
  });

  updatedEntries.push({
    subActivityId: sub.id,
    subActivityName: sub.name,
    computedValue: result.computedValue,
    priorComputedValue: result.priorComputedValue,
    isUpdate: result.isUpdate,
    scoreEntryId: result.scoreEntryId,
  });
}
```

Add the import at the top of the file:

```ts
import { validateAndComputeSub, persistSubScore } from "@/lib/scoring-save";
```

Remove the now-unused `computeValue` import if nothing else in the file uses it.

- [ ] **Step 6: Verify build + existing tests still pass**

Run: `npm test && npx tsc --noEmit`
Expected: all tests PASS; no type errors. Manually confirm the existing per-team save still works in the next task's manual check, or via `npm run dev`.

- [ ] **Step 7: Commit**

```bash
git add lib/scoring-save.ts lib/scoring-save.test.ts app/api/scores/route.ts
git commit -m "refactor: extract shared sub-activity save helper"
```

---

### Task 2: Add `POST /api/scores/batch` endpoint

Save one sub-activity across many teams in a single transaction, reusing the Task 1 helper.

**Files:**
- Create: `app/api/scores/batch/route.ts`

**Interfaces:**
- Consumes: `validateAndComputeSub`, `persistSubScore` (Task 1); `requireAdmin`, `badRequest`, `notFound`; `audit`; `publishEvent`; `prisma`.
- Produces: `POST /api/scores/batch` accepting `{ activityId: string, subActivityId: string, teams: [{ teamId: string, raws: Record<string, number> }] }`, returning `{ ok: true, results: [{ teamId: string, subActivityId: string, computedValue: number }] }`.

- [ ] **Step 1: Write the route**

Create `app/api/scores/batch/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, badRequest, notFound } from "@/lib/api";
import { validateAndComputeSub, persistSubScore } from "@/lib/scoring-save";
import { publishEvent } from "@/lib/pubnub-server";
import { audit } from "@/lib/audit";

// Saves one sub-activity's score for many teams in a single transaction.
const schema = z.object({
  activityId: z.string(),
  subActivityId: z.string(),
  teams: z
    .array(
      z.object({
        teamId: z.string(),
        raws: z.record(z.string(), z.number()),
      }),
    )
    .min(1),
});

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid batch score", parsed.error.flatten());
  const { activityId, subActivityId, teams } = parsed.data;

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: { event: true, subActivities: { include: { inputFields: true } } },
  });
  if (!activity) return notFound("Activity not found");
  if (activity.event.isLocked) return badRequest("Event is locked");

  const sub = activity.subActivities.find((s) => s.id === subActivityId);
  if (!sub) return notFound("Sub-activity not found in activity");

  const subShape = {
    id: sub.id,
    name: sub.name,
    inputRule: sub.inputRule,
    sortDirection: sub.sortDirection,
    inputFields: sub.inputFields.map((f) => ({
      id: f.id,
      label: f.label,
      targetValue: f.targetValue,
    })),
  };

  // Validate every team belongs to this event before writing anything.
  const teamIds = teams.map((t) => t.teamId);
  const teamRows = await prisma.team.findMany({
    where: { id: { in: teamIds }, eventId: activity.eventId },
  });
  if (teamRows.length !== teamIds.length) {
    return badRequest("One or more teams do not belong to this event");
  }
  const teamById = new Map(teamRows.map((t) => [t.id, t]));

  const saved: {
    teamId: string;
    teamNumber: number;
    teamName: string;
    scoreEntryId: string;
    computedValue: number;
    priorComputedValue: number | null;
    isUpdate: boolean;
  }[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      for (const entry of teams) {
        const computed = validateAndComputeSub(subShape, entry.raws);
        const result = await persistSubScore(tx, {
          teamId: entry.teamId,
          sub: subShape,
          raws: entry.raws,
          adminId: auth.adminId,
          computed,
        });
        const team = teamById.get(entry.teamId)!;
        saved.push({
          teamId: entry.teamId,
          teamNumber: team.teamNumber,
          teamName: team.name,
          scoreEntryId: result.scoreEntryId,
          computedValue: result.computedValue,
          priorComputedValue: result.priorComputedValue,
          isUpdate: result.isUpdate,
        });
      }
    });
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Save failed");
  }

  for (const s of saved) {
    await audit({
      adminId: auth.adminId,
      action: s.isUpdate ? "update" : "create",
      entityType: "score",
      entityId: s.scoreEntryId,
      eventId: activity.eventId,
      summary: s.isUpdate
        ? `Updated ${activity.name} → ${sub.name} for team #${s.teamNumber} ${s.teamName} (${s.priorComputedValue} → ${s.computedValue})`
        : `Logged ${activity.name} → ${sub.name} for team #${s.teamNumber} ${s.teamName} = ${s.computedValue}`,
      details: {
        teamId: s.teamId,
        teamNumber: s.teamNumber,
        teamName: s.teamName,
        activityId: activity.id,
        activityName: activity.name,
        subActivityId: sub.id,
        subActivityName: sub.name,
        oldComputedValue: s.priorComputedValue,
        newComputedValue: s.computedValue,
      },
    });
  }

  await publishEvent({
    type: "score_updated",
    eventId: activity.eventId,
    payload: {
      activityId,
      subActivityId,
      teams: saved.map((s) => ({ teamId: s.teamId, computedValue: s.computedValue })),
    },
    ts: Date.now(),
  });

  return NextResponse.json({
    ok: true,
    results: saved.map((s) => ({
      teamId: s.teamId,
      subActivityId: sub.id,
      computedValue: s.computedValue,
    })),
  });
}
```

- [ ] **Step 2: Verify it type-checks and builds**

Run: `npx tsc --noEmit`
Expected: no errors. (Confirm `AuditAction` includes `"create"`/`"update"` and `AuditEntityType` includes `"score"` — they are used identically by the existing per-team route, so this matches.)

- [ ] **Step 3: Manual smoke test**

Run `npm run dev`, log in as admin, then from the browser console or a REST client POST to `/api/scores/batch` with a valid `activityId`, one of its `subActivityId`s, and two teams' `raws`. Expected: `{ ok: true, results: [...] }`, and the values appear on the existing per-team log page after reload. Then POST again with a partial `raws` (missing a field) → expect HTTP 400 with the `Missing input ...` message and **no** partial write (transaction rolls back).

- [ ] **Step 4: Commit**

```bash
git add app/api/scores/batch/route.ts
git commit -m "feat: batch score endpoint for one sub-activity across teams"
```

---

### Task 3: View toggle + BatchScoreView on the log page

Add a persistent "By team / By sub-activity" toggle to the log page; render the existing flow for "By team" and a new `BatchScoreView` for "By sub-activity". The batch view fetches teams (with roster + photos), lets the host pick a sub-activity, prefills existing values, and saves all changed/complete rows via the Task 2 endpoint.

**Files:**
- Create: `app/admin/events/[id]/activities/[aid]/log/BatchScoreView.tsx`
- Modify: `app/admin/events/[id]/activities/[aid]/log/page.tsx` (add toggle + conditional render)

**Interfaces:**
- Consumes: `GET /api/activities/[aid]` (returns `{ activity }` with subActivities + inputFields); `GET /api/events/[id]/teams` (returns `{ teams }` with `photos[]` and `rosterUsers[]`); `GET /api/teams/[id]/activity-scores?activityId=...` (per-team existing scores); `POST /api/scores/batch` (Task 2); `TimeInput`, `shouldUseTimeInput`.
- Produces: default-exported React component `BatchScoreView({ eventId, activityId }: { eventId: string; activityId: string })`.

- [ ] **Step 1: Verify the teams endpoint shape**

Confirm `GET /api/events/[id]/teams` returns `{ teams: [{ id, name, teamNumber, cohortNumber, photos: [{ s3Url }], rosterUsers: [{ firstName, lastName }] }] }`. (It does — `route.ts` includes `photos` ordered by `displayOrder` and `rosterUsers`.) Existing scores per team come from `GET /api/teams/[id]/activity-scores?activityId=` which returns `{ entries: [{ subActivityId, inputs: [{ inputFieldId, rawValue }] }] }`.

- [ ] **Step 2: Write `BatchScoreView.tsx`**

Create `app/admin/events/[id]/activities/[aid]/log/BatchScoreView.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TimeInput, shouldUseTimeInput } from "@/components/TimeInput";

type InputField = { id: string; label: string; unit: string; targetValue: number | null };
type SubActivity = {
  id: string;
  name: string;
  inputRule: "single_value" | "sum_of_pct_deviation" | "abs_deviation_from_target";
  sortDirection: "asc" | "desc";
  inputFields: InputField[];
};
type Activity = { id: string; name: string; subActivities: SubActivity[] };
type Member = { firstName: string; lastName: string };
type Team = {
  id: string;
  name: string;
  teamNumber: number;
  cohortNumber: number | null;
  photos: { s3Url: string }[];
  rosterUsers: Member[];
};

// raws[teamId][inputFieldId] = string the host typed (empty string = blank).
type RawMap = Record<string, Record<string, string>>;
// stored[teamId][inputFieldId] = the saved value as a string, for change detection.
type StoredMap = Record<string, Record<string, string>>;

function isComplete(sub: SubActivity, teamRaws: Record<string, string> | undefined): boolean {
  if (!teamRaws) return false;
  return sub.inputFields.every(
    (f) => teamRaws[f.id] !== undefined && teamRaws[f.id] !== "" && Number.isFinite(parseFloat(teamRaws[f.id])),
  );
}

function isPartial(sub: SubActivity, teamRaws: Record<string, string> | undefined): boolean {
  if (!teamRaws) return false;
  const filled = sub.inputFields.filter((f) => teamRaws[f.id] !== undefined && teamRaws[f.id] !== "");
  return filled.length > 0 && filled.length < sub.inputFields.length;
}

function isChanged(
  sub: SubActivity,
  teamRaws: Record<string, string> | undefined,
  stored: Record<string, string> | undefined,
): boolean {
  if (!teamRaws) return false;
  return sub.inputFields.some((f) => (teamRaws[f.id] ?? "") !== (stored?.[f.id] ?? ""));
}

export default function BatchScoreView({
  eventId,
  activityId,
}: {
  eventId: string;
  activityId: string;
}) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [raws, setRaws] = useState<RawMap>({});
  const [stored, setStored] = useState<StoredMap>({});
  const [subId, setSubId] = useState<string>("");
  const [cohort, setCohort] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, t] = await Promise.all([
      fetch(`/api/activities/${activityId}`).then((r) => r.json()),
      fetch(`/api/events/${eventId}/teams`).then((r) => r.json()),
    ]);
    const act: Activity = a.activity;
    setActivity(act);
    setSubId((prev) => prev || act.subActivities[0]?.id || "");
    const teamList: Team[] = t.teams;
    setTeams(teamList);

    // Fetch existing scores for every team so inputs prefill.
    const scoreLists = await Promise.all(
      teamList.map((tm) =>
        fetch(`/api/teams/${tm.id}/activity-scores?activityId=${activityId}`)
          .then((r) => r.json())
          .then((d) => ({ teamId: tm.id, entries: d.entries as { subActivityId: string; inputs: { inputFieldId: string; rawValue: number }[] }[] }))
          .catch(() => ({ teamId: tm.id, entries: [] })),
      ),
    );
    const nextRaws: RawMap = {};
    const nextStored: StoredMap = {};
    for (const { teamId, entries } of scoreLists) {
      nextRaws[teamId] = {};
      nextStored[teamId] = {};
      for (const e of entries) {
        for (const i of e.inputs) {
          nextRaws[teamId][i.inputFieldId] = String(i.rawValue);
          nextStored[teamId][i.inputFieldId] = String(i.rawValue);
        }
      }
    }
    setRaws(nextRaws);
    setStored(nextStored);
    setLoading(false);
  }, [activityId, eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const cohorts = useMemo(
    () =>
      Array.from(new Set(teams.map((t) => t.cohortNumber).filter((n): n is number => n != null))).sort(
        (a, b) => a - b,
      ),
    [teams],
  );

  const sub = activity?.subActivities.find((s) => s.id === subId) ?? null;

  const visibleTeams = useMemo(
    () =>
      (cohort === "all" ? teams : teams.filter((t) => t.cohortNumber === parseInt(cohort, 10))).sort(
        (a, b) => a.teamNumber - b.teamNumber,
      ),
    [teams, cohort],
  );

  // Count, for each sub-activity pill, how many visible teams have a stored value.
  const loggedCount = useCallback(
    (s: SubActivity) =>
      visibleTeams.filter((t) => s.inputFields.every((f) => stored[t.id]?.[f.id] !== undefined)).length,
    [visibleTeams, stored],
  );

  const setRaw = (teamId: string, fieldId: string, value: string) => {
    setRaws((prev) => ({ ...prev, [teamId]: { ...prev[teamId], [fieldId]: value } }));
    setSavedMsg(null);
  };

  const dirtyTeamIds = useMemo(() => {
    if (!sub) return [] as string[];
    return visibleTeams
      .filter((t) => isComplete(sub, raws[t.id]) && isChanged(sub, raws[t.id], stored[t.id]))
      .map((t) => t.id);
  }, [sub, visibleTeams, raws, stored]);

  const partialCount = useMemo(
    () => (sub ? visibleTeams.filter((t) => isPartial(sub, raws[t.id])).length : 0),
    [sub, visibleTeams, raws],
  );

  const guardedSwitch = (fn: () => void) => {
    if (dirtyTeamIds.length > 0) {
      if (!window.confirm("You have unsaved values. Discard them and switch?")) return;
    }
    fn();
  };

  const save = async () => {
    if (!sub) return;
    setSaving(true);
    setError(null);
    try {
      const payloadTeams = dirtyTeamIds.map((teamId) => {
        const r: Record<string, number> = {};
        for (const f of sub.inputFields) r[f.id] = parseFloat(raws[teamId][f.id]);
        return { teamId, raws: r };
      });
      if (payloadTeams.length === 0) {
        setError("No complete, changed rows to save.");
        return;
      }
      const res = await fetch("/api/scores/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId, subActivityId: sub.id, teams: payloadTeams }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Save failed");
        return;
      }
      setSavedMsg(`Saved ${payloadTeams.length} team${payloadTeams.length === 1 ? "" : "s"} for ${sub.name}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !activity) return <p>Loading…</p>;

  return (
    <div className="space-y-4 pb-24">
      {/* Sub-activity picker */}
      <div className="flex flex-wrap gap-2">
        {activity.subActivities.map((s) => (
          <button
            key={s.id}
            onClick={() => guardedSwitch(() => setSubId(s.id))}
            className={`btn text-sm ${s.id === subId ? "btn-primary" : "btn-secondary"}`}
          >
            {s.name}{" "}
            <span className="ml-1 text-xs opacity-70">
              {loggedCount(s)}/{visibleTeams.length}
            </span>
          </button>
        ))}
      </div>

      {/* Cohort filter */}
      {cohorts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            className={`btn text-sm ${cohort === "all" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => guardedSwitch(() => setCohort("all"))}
          >
            All
          </button>
          {cohorts.map((c) => (
            <button
              key={c}
              className={`btn text-sm ${cohort === String(c) ? "btn-primary" : "btn-secondary"}`}
              onClick={() => guardedSwitch(() => setCohort(String(c)))}
            >
              Cohort {c}
            </button>
          ))}
        </div>
      )}

      {savedMsg && (
        <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          <strong>Saved.</strong> {savedMsg}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Team rows */}
      {sub && (
        <ul className="space-y-2">
          {visibleTeams.map((t) => {
            const teamRaws = raws[t.id];
            const complete = isComplete(sub, teamRaws);
            const partial = isPartial(sub, teamRaws);
            const changed = isChanged(sub, teamRaws, stored[t.id]);
            const useTime =
              sub.inputFields.length === 1 && shouldUseTimeInput(sub.inputRule, sub.inputFields[0].unit);
            return (
              <li key={t.id} className="card flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                    {t.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.photos[0].s3Url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      `#${t.teamNumber}`
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold">
                      #{t.teamNumber} {t.name}
                      {complete && changed && <span className="badge badge-blue ml-2">Edited</span>}
                      {complete && !changed && <span className="badge badge-green ml-2">Saved</span>}
                      {partial && <span className="badge badge-amber ml-2">Incomplete</span>}
                    </div>
                    {t.rosterUsers.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
                        {t.rosterUsers.map((m, i) => (
                          <span key={i}>
                            {m.firstName} {m.lastName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {useTime ? (
                    <div className="w-40">
                      <label className="label text-xs">
                        {sub.inputFields[0].label} <span className="text-slate-500">(min : sec)</span>
                      </label>
                      <TimeInput
                        value={teamRaws?.[sub.inputFields[0].id] ?? ""}
                        onChange={(v) => setRaw(t.id, sub.inputFields[0].id, v)}
                      />
                    </div>
                  ) : (
                    sub.inputFields.map((f) => (
                      <div key={f.id} className="w-28">
                        <label className="label text-xs">
                          {f.label}{" "}
                          <span className="text-slate-500">
                            ({f.unit}
                            {f.targetValue != null ? `, t${f.targetValue}` : ""})
                          </span>
                        </label>
                        <input
                          className="input"
                          type="number"
                          inputMode="decimal"
                          step="any"
                          value={teamRaws?.[f.id] ?? ""}
                          onChange={(e) => setRaw(t.id, f.id, e.target.value)}
                        />
                      </div>
                    ))
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {partialCount > 0
              ? `${partialCount} row${partialCount === 1 ? "" : "s"} partially filled — complete or clear to save.`
              : `${dirtyTeamIds.length} change${dirtyTeamIds.length === 1 ? "" : "s"} ready.`}
          </p>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || dirtyTeamIds.length === 0 || partialCount > 0}
          >
            {saving ? "Saving…" : `Save ${dirtyTeamIds.length} change${dirtyTeamIds.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the toggle to `page.tsx`**

In `app/admin/events/[id]/activities/[aid]/log/page.tsx`:

(a) Add the import near the top (after existing imports):

```tsx
import BatchScoreView from "./BatchScoreView";
```

(b) Add view-mode state with `localStorage` persistence. Inside `ScoreLogPage`, after the existing `useState` declarations (around the `savedTeamName` state), add:

```tsx
const [viewMode, setViewMode] = useState<"team" | "sub">("team");
// Restore the host's preferred layout once on mount; persist on change.
useEffect(() => {
  const saved = window.localStorage.getItem("logViewMode");
  if (saved === "team" || saved === "sub") setViewMode(saved);
}, []);
const setView = (m: "team" | "sub") => {
  setViewMode(m);
  window.localStorage.setItem("logViewMode", m);
};
```

(c) Render the toggle and branch. Immediately after the sticky context-bar `<div>...</div>` (the block that renders `activity.name` and the ⓘ button, closing at the line with `</div>` before the `savedTeamName` banner), insert the toggle:

```tsx
<div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
  <button
    onClick={() => setView("team")}
    className={`rounded px-3 py-1 ${viewMode === "team" ? "bg-brand text-white" : "text-slate-600 hover:text-brand"}`}
  >
    By team
  </button>
  <button
    onClick={() => setView("sub")}
    className={`rounded px-3 py-1 ${viewMode === "sub" ? "bg-brand text-white" : "text-slate-600 hover:text-brand"}`}
  >
    By sub-activity
  </button>
</div>

{viewMode === "sub" ? (
  <BatchScoreView eventId={params.id} activityId={params.aid} />
) : (
```

Then wrap the **existing** "By team" UI — the `savedTeamName` banner, cohort pills, sort toggle, team `<ul>`, and the `openTeam`/`showExplain` modals — by closing the conditional with `)}` placed just before the final `</div>` that closes the component's root element. The `{showExplain && ...}` and `{openTeam && ...}` blocks stay inside the `team` branch.

Concretely, the JSX becomes:

```tsx
return (
  <div className="space-y-4">
    {/* sticky context bar — unchanged */}
    <div className="sticky ...">...</div>

    {/* NEW: view toggle */}
    <div className="inline-flex ...">...</div>

    {viewMode === "sub" ? (
      <BatchScoreView eventId={params.id} activityId={params.aid} />
    ) : (
      <>
        {/* ALL existing by-team JSX: savedTeamName banner, cohort pills,
            sort toggle, team <ul>, {openTeam && <ScoreEditor .../>},
            {showExplain && <div>…</div>} */}
      </>
    )}
  </div>
);
```

Note: the early `if (!activity) return <p>Loading…</p>;` guard stays above the `return`, so `params` and the toggle render only once the activity loads. Keep `BatchScoreView` inside the conditional so it mounts only when selected (it does its own fetching).

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open an event's Gut Check log page (`/admin/events/<id>/activities/<aid>/log`):
1. Toggle shows **By team** by default; existing modal flow works unchanged.
2. Switch to **By sub-activity**: pills for Point North / Timer Test / Weight Test / Measurement Test appear with `logged/total` counts. Each team row shows photo + #number + name + member names, with the selected sub's input(s) on the right.
3. Enter values for several teams, leave one partially filled → save button disabled with the "partially filled" hint; complete or clear it → button enables showing the change count.
4. Save → green banner, counts update, rows flip to **Saved**; reload page → values persist and toggle stays on **By sub-activity** (localStorage).
5. Switch sub-activity/cohort with unsaved complete edits → confirm prompt appears.
6. Open a single-sub-activity activity's log page (e.g. Cross the Ocean) → one pill, rows render correctly.

- [ ] **Step 6: Commit**

```bash
git add "app/admin/events/[id]/activities/[aid]/log/BatchScoreView.tsx" "app/admin/events/[id]/activities/[aid]/log/page.tsx"
git commit -m "feat: by-sub-activity batch logging view with persistent toggle"
```

---

## Self-Review

**Spec coverage:**
- Sub-activity picker with progress hint → Task 3 pills + `loggedCount`. ✓
- Cohort filter reused → Task 3. ✓
- Team rows with photo + #number + name + member names → Task 3 row markup. ✓
- Input(s) per sub, TimeInput for time fields → Task 3 `useTime` branch. ✓
- Per-row Saved/Edited/Incomplete status → Task 3 badges. ✓
- Sticky "Save N changes" bar, disabled when nothing complete-and-changed → Task 3. ✓
- Prefill + freely editable (no lock) → Task 3 `load()` fills raws + stored. ✓
- Save only complete+changed rows; partial blocks save → Task 3 `dirtyTeamIds`/`partialCount`. ✓
- Confirm on sub/cohort switch with unsaved edits → Task 3 `guardedSwitch`. ✓
- View toggle on every log page, persisted, default by-team → Task 3 `viewMode` + localStorage. ✓
- `POST /api/scores/batch` with shared helper, one transaction, per-team audit, single publish → Tasks 1 & 2. ✓
- Refactor shared helper out of per-team endpoint (no duplication) → Task 1. ✓
- Unit tests for validation/compute → Task 1 test file. ✓

**Type consistency:** `validateAndComputeSub` / `persistSubScore` signatures match between Task 1 (definition), Task 1 Step 5 (per-team use), and Task 2 (batch use). `SubWithFields` shape used identically everywhere. `BatchScoreView` props `{ eventId, activityId }` match the Task 3 call site. ✓

**Placeholder scan:** No TBD/TODO; all steps contain concrete code or exact commands. ✓
