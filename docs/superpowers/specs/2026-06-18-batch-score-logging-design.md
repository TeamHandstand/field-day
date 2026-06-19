# Batch score-logging by sub-activity

**Date:** 2026-06-18
**Route affected:** `/admin/events/[id]/activities/[aid]/log` (every activity's log page, incl. Gut Check)

## Problem

The score log page currently logs **team-by-team**: tap a team → modal → enter all of
that activity's sub-activities → save. For activities with many sub-activities / input
fields (e.g. Gut Check: Point North, Timer Test, Weight Test, Measurement Test — several
with 3 attempt fields each), a host running one physical station wants the opposite axis:
pick the one thing being measured, enter **every team's** value for it, and save all at once.

## Goal

Add a second data-entry layout — **by sub-activity** — and let the user switch between it
and the existing **by-team** layout on every `/log` page. The user's choice persists.

## Layouts

### View toggle (on every log page)
A segmented control near the top: **By team** | **By sub-activity**.
- **By team** = the existing behavior (team list → per-team modal), unchanged.
- **By sub-activity** = the new batch layout below.
- Selection persists in `localStorage` (key shared across activities) so it sticks as the
  host moves between activities. Defaults to **By team** (current behavior) on first use.

### By-sub-activity (batch) layout
1. **Sub-activity picker** — pill buttons (styled like the existing cohort pills), one per
   sub-activity. Each pill shows a progress hint `logged/total` for the visible cohort.
   For single-sub-activity activities there is just one pill (still shown for consistency).
2. **Cohort filter** — unchanged (All / Cohort N), reused from current page.
3. **Team list for the selected sub-activity** — one row per visible team:
   - Left: team **photo** (or `#number` fallback), **#number + name**, and **member
     first/last names** (compact wrap).
   - Right: the **input field(s)** for the selected sub-activity. Single time-based field
     uses the existing `TimeInput`; otherwise a numeric input per field with its label,
     unit, and target hint (reusing the current input rendering logic).
   - A subtle per-row status: **Saved** (has a stored value, unchanged), **Edited** (value
     changed from stored), **Incomplete** (some but not all fields of a multi-field sub
     filled).
4. **Sticky save bar** — `Save N change(s)` button. Disabled when nothing is complete-and-
   changed. Shows inline error if any row is partially filled.

## Save semantics (batch layout)

- On load: fetch teams (with photos + roster) and existing scores for the activity; prefill
  every input with its stored raw value. **Freely editable** — no lock step.
- Save sends only rows that are **complete** (every input field for the selected sub filled
  with a finite number) **and changed** from the stored value. Blank rows stay unlogged.
- Partially-filled rows (e.g. 2 of 3 attempts) are flagged inline and **block save** with a
  clear message — mirrors existing `evaluateSub` validation.
- Switching sub-activity or cohort while unsaved complete edits exist prompts a confirm.
- After a successful save: success toast (reuse existing `savedTeamName`-style banner,
  generalized to a count/sub-activity message) and reload of scores.

## Backend

New endpoint **`POST /api/scores/batch`**.

Body:
```
{ activityId: string, subActivityId: string, teams: [{ teamId: string, raws: Record<inputFieldId, number> }] }
```

Behavior:
- `requireAdmin`; reject if event locked.
- Validate the sub-activity belongs to the activity/event; validate each team belongs to
  the event; validate inputs/targets per `inputRule` (same rules as `POST /api/scores`).
- One `prisma.$transaction`: for each team, `computeValue` then upsert `ScoreEntry` +
  replace `ScoreInput` rows for that `(team, subActivity)`.
- One `audit` entry per team saved (create/update, same summary shape as existing).
- A single `score_updated` pubnub publish covering all affected teams.
- Response: `{ ok: true, results: [{ teamId, subActivityId, computedValue }] }`.

**Refactor:** extract the per-sub upsert+validate+compute block currently inline in
`POST /api/scores` into a shared helper (e.g. `lib/scoring-save.ts` `saveSubActivityScore`)
and use it from both the per-team and batch endpoints — no duplicated logic.

## Out of scope

- No change to the by-team modal flow itself.
- No new per-member photos (roster users have names only; "profile picture" = team photo).
- No change to scoring math, leaderboard, or finalization.

## Testing

- Unit: shared save helper validation (missing field, bad target, partial fill) + compute.
- API: `POST /api/scores/batch` happy path (multi-team), locked-event rejection, partial/
  invalid rejection, mixed create+update.
- Component/manual: toggle persistence, prefill, per-row status transitions, save count,
  cohort/sub switch confirm, single-sub-activity activity renders correctly.
