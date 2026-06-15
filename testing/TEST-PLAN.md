# Field Day — Full QA Test Plan

End-to-end manual test of **every seeded activity template** and the complete
scoring → leaderboard → finalization pipeline. Every "Expected" number in this
document is **computed by the real scoring engine**, not by hand: see
`lib/scenario.test.ts`, which builds this exact scenario and asserts these
results. If the app ever disagrees with this plan, run that test — the engine
is the source of truth.

> **One scenario, total coverage.** A single event with **6 teams** across
> **2 cohorts** exercises all 4 templates, both aggregation rules, all input
> rules in use, tie handling, coverage-gap exclusion, the cohort filter, and
> lock/finalize/unlock. Score it once, verify the live board, finalize, verify
> the final board.

---

## What the 4 seeded templates are

| Template | Aggregation | Sub-activities | Input rule | Sort | Unit | Winner |
|---|---|---|---|---|---|---|
| **Cross the Ocean** | single | Cross the Ocean | single_value | asc | seconds | fastest |
| **Team Slingshot** | single | Team Slingshot | single_value | asc | seconds | fastest |
| **Splash Zone** | single | Splash Zone | single_value | **desc** | grams | heaviest |
| **Gut Check** | **sum_of_ranks** | Point North; Timer Test; Weight Test; Measurement Test | single_value + 3× **sum_of_pct_deviation** | asc | degrees / sec / grams / cm | lowest summed rank |

> ⚠️ **Gut Check gotcha — you MUST set targets before scoring.** Timer Test
> ships with default targets (30 / 60 / 90). **Weight Test and Measurement Test
> have NO default targets.** Until you set a non-zero target on every attempt
> field, the activities page shows a red **"Missing targets"** badge and the
> score API rejects saves with *"needs non-zero targets"*. This plan sets
> Weight → 100/200/300 and Measurement → 50/100/150.

### How scoring works (reference)
- **single_value** → the entered number is the score.
- **sum_of_pct_deviation** → for each attempt, `|raw − target| / |target| × 100`; sum the percentages. Lower = better. Target must be non-zero.
- **abs_deviation_from_target** → `|raw − target|`; closest wins. *(Not used by any seeded template — see [Optional Test J](#optional-test-j--abs_deviation_from_target-custom-activity).)*
- **Rank within a sub-activity**: sort by value (asc/desc); **ties share the average of the positions they occupy** (two teams tied for 1st/2nd → both rank **1.5**).
- **single** activity rank = its one sub-activity's rank.
- **sum_of_ranks** activity rank = sum each team's sub-activity ranks, then re-rank ascending (lowest sum = 1st).
- **Coverage gap**: a team missing **any** sub-activity of an activity is **excluded** from that activity → rank shows `—`, earns **0 points** there.
- **Points** for an activity (N teams): `points = (N + 1) − rank`. With N=6, 1st = 6 pts, last = 1 pt. Excluded = 0.
- **Overall / global rank**: sum a team's points across all activities; highest total = 1st (ties averaged).

> 🔎 **Display rounding quirk (expected, not a bug).** The leaderboard prints
> ranks as `ordinal(round(rank))`, and JS rounds `.5` **up**. So a team tied
> for **1st** (rank 1.5) displays as **"2nd"**, and a tie at rank 3.5 displays
> as **"4th"**. **Points and Totals are shown exactly** (e.g. `5.5`). This is
> why, in this scenario, *no team ever displays "1st"* on a tied column even
> though two teams genuinely tied for the top. Watch for it below.

---

## 0. Prerequisites & setup

```bash
# from repo root
cp .env.example .env            # if you don't already have .env; set DATABASE_URL
npm install

# Point at a SCRATCH database (this plan creates/locks/finalizes data).
npm run db:push                 # apply schema
SEED_ADMIN_EMAIL=admin@test.dev SEED_ADMIN_PASSWORD=test123 npm run db:seed
#   ^ seeds the admin AND the 4 system activity templates

npm run dev                     # http://localhost:3000
```

Log in at **http://localhost:3000/admin/login** with the seeded admin
(`admin@test.dev` / `test123`).

> If templates were already seeded, the seeder prints *"System-seeded templates
> already present, skipping."* — that's fine. Confirm all 4 appear at
> **/admin/templates**.

---

## Phase A — Automated engine tests (run first)

These prove the pure scoring math before any clicking.

```bash
npx vitest run lib/scoring.test.ts lib/scenario.test.ts
```

**Expected:** all tests pass. `lib/scenario.test.ts` prints a
`===== GROUND TRUTH =====` report — that report is exactly the per-activity and
overall numbers you will verify in the UI below.

---

## Phase B — Create the event

1. Go to **/admin/events** → create event **"QA Field Day"**.
2. Open it. Expect: not locked, not finalized, 0 teams, 0 activities.

**Leaderboard status now:** open the event leaderboard — title reads
**"Live Standings — QA Field Day"**, subtitle *"Final standings published when
the event ends."*, empty table.

---

## Phase C — Import teams + roster (CSV)

1. Event → **Teams** → **Choose CSV** → select **`testing/csv/teams.csv`**.
2. **Expected preview:** **6 teams · 18 roster members · 0 skipped rows**, table:

   | # | Team | Cohort | Roster |
   |---|---|---|---|
   | 1 | Sharks | 1 | Ava Nguyen, Liam Patel, Mia Johnson |
   | 2 | Dolphins | 1 | Noah Garcia, Emma Smith, Oliver Brown |
   | 3 | Krakens | 1 | Sophia Davis, Lucas Martin, Isabella Lopez |
   | 4 | Otters | 2 | Ethan Wilson, Charlotte Lee, Mason Walker |
   | 5 | Penguins | 2 | Amelia Hall, James Young, Harper King |
   | 6 | Narwhals | 2 | Benjamin Wright, Evelyn Scott, Henry Green |

3. Click **Import 6 teams + 18 members**.
4. **Expected:** team list shows 6 cards `#1 Sharks … #6 Narwhals`, each with
   "Cohort N · 3 roster". Audit log records *"Imported 6 teams (+18 roster) from CSV"*.

### C2 — CSV error handling (negative test)
1. Choose **`testing/csv/teams-bad-rows.csv`**.
2. **Expected preview:** **2 teams · 1 roster member · 5 skipped rows**, with
   these 5 errors listed (row numbers = file line numbers):
   - Row 3: roster member needs both first and last name (`Jack` / ``)
   - Row 4: team #7 already named "Eagles", got "Eagels"
   - Row 5: invalid cohort "abc"
   - Row 6: missing team name
   - Row 7: invalid team number "xx"
   - The 2 surviving teams: **#7 Eagles** (1 member: Grace Adams) and
     **#10 Robins** (0 members — empty first/last is allowed, creates an empty team).
3. **Do NOT import** — click **Cancel**. (Importing would add teams 7 & 10 and
   throw off the scoring scenario.) The point is to confirm the parser reports
   errors and never silently drops a malformed row.

---

## Phase D — Add the 4 activities from templates

In **Event → Activities**, add each template **in this order** (order matters
only for column order on the board):

1. Add **Cross the Ocean**
2. Add **Team Slingshot**
3. Add **Splash Zone**
4. Add **Gut Check**

### D2 — Set Gut Check targets (required!)
- Gut Check shows a red **"Missing targets"** badge.
- Edit Gut Check. Set targets:
  - **Timer Test** — already 30 / 60 / 90 (leave as-is).
  - **Weight Test** — Attempt 1 = **100**, Attempt 2 = **200**, Attempt 3 = **300**.
  - **Measurement Test** — Attempt 1 = **50**, Attempt 2 = **100**, Attempt 3 = **150**.
  - **Point North** — single_value, target shows "n/a" (none needed).
- Save. **Expected:** the "Missing targets" badge disappears.

---

## Phase E — Enter scores

Use **Event → Teams → [team] → log scores**, or the activity **Log** page. Enter
exactly these raw values. **Leave every cell marked `—` blank (do not enter 0).**

> Times are entered in the score form's min:sec / seconds input; the values
> below are the **seconds** the engine stores.

### Cross the Ocean — Time (seconds)
| Team | Time |
|---|---|
| #1 Sharks | 45 |
| #2 Dolphins | 50 |
| #3 Krakens | 45 |
| #4 Otters | 60 |
| #5 Penguins | 55 |
| #6 Narwhals | — *(leave blank: tests exclusion)* |

### Team Slingshot — Time (seconds)
| Team | Time |
|---|---|
| #1 Sharks | 30 |
| #2 Dolphins | 20 |
| #3 Krakens | 40 |
| #4 Otters | 35 |
| #5 Penguins | 25 |
| #6 Narwhals | 50 |

### Splash Zone — Weight (grams) — heaviest wins
| Team | Weight |
|---|---|
| #1 Sharks | 1000 |
| #2 Dolphins | 1500 |
| #3 Krakens | 1500 |
| #4 Otters | 800 |
| #5 Penguins | 1200 |
| #6 Narwhals | 900 |

### Gut Check (enter all 4 sub-activities per team)
**Point North — Degrees off North**
| Team | Degrees |
|---|---|
| #1 | 10 | 
| #2 | 5 | 
| #3 | 20 | 
| #4 | 15 | 
| #5 | 25 | 
| #6 | 8 |

**Timer Test — Attempt 1 / 2 / 3 (seconds; targets 30/60/90)**
| Team | A1 | A2 | A3 |
|---|---|---|---|
| #1 | 30 | 60 | 90 |
| #2 | 33 | 66 | 99 |
| #3 | 36 | 72 | 108 |
| #4 | 39 | 78 | 117 |
| #5 | 30 | 60 | 99 |
| #6 | 33 | 60 | 99 |

**Weight Test — Attempt 1 / 2 / 3 (grams; targets 100/200/300)**
| Team | A1 | A2 | A3 |
|---|---|---|---|
| #1 | 100 | 200 | 300 |
| #2 | 110 | 220 | 330 |
| #3 | 100 | 220 | 300 |
| #4 | 110 | 200 | 300 |
| #5 | 100 | 200 | 330 |
| #6 | 110 | 200 | 300 |

**Measurement Test — Attempt 1 / 2 / 3 (cm; targets 50/100/150)**
| Team | A1 | A2 | A3 |
|---|---|---|---|
| #1 | 50 | 100 | 150 |
| #2 | 55 | 110 | 165 |
| #3 | 50 | 105 | 150 |
| #4 | 55 | 100 | 150 |
| #5 | 50 | 100 | 160 |
| #6 | — | — | — *(leave ALL blank: excludes #6 from Gut Check)* |

### E2 — Verify computed sub-activity values
On a sub-activity **Log** page, the saved **computed value** for the deviation
sub-activities should read:

**Timer Test** (sum of % deviation): #1=**0**, #2=**30**, #3=**60**, #4=**90**, #5=**10**, #6=**20**
**Weight Test**: #1=**0**, #2=**30**, #3=**10**, #4=**10**, #5=**10**, #6=**10**
**Measurement Test**: #1=**0**, #2=**30**, #3=**5**, #4=**10**, #5≈**6.67**, #6=*(none)*
(Point North is single_value → stored as entered.)

> #5's 6.67 = `|160−150|/150×100`. Good sanity check that the % math is live.

---

## Phase F — Verify the LIVE leaderboard (before finalizing)

Open **Event → Leaderboard**. **Expected status:**
- Title **"Live Standings — QA Field Day"**, subtitle *"Final standings published when the event ends."*
- **Rank** column shows `—` for **every** team (global rank only exists after finalize).
- **No "Total" column.**
- Rows in **team-number order** (#1…#6).
- Each activity column shows the team's **live rank in that activity** as an ordinal (remember the round-half-up display quirk), or `—` if excluded.

**Expected per-activity live ranks** (displayed ordinal in parentheses):

| Team | Cross the Ocean | Team Slingshot | Splash Zone | Gut Check |
|---|---|---|---|---|
| #1 Sharks | 1.5 → **2nd** | 3 → 3rd | 4 → 4th | 1 → **1st** |
| #2 Dolphins | 3 → 3rd | 1 → **1st** | 1.5 → **2nd** | 4 → 4th |
| #3 Krakens | 1.5 → **2nd** | 5 → 5th | 1.5 → **2nd** | 3 → 3rd |
| #4 Otters | 5 → 5th | 4 → 4th | 6 → 6th | 5 → 5th |
| #5 Penguins | 4 → 4th | 2 → 2nd | 3 → 3rd | 2 → 2nd |
| #6 Narwhals | **—** (excluded) | 6 → 6th | 5 → 5th | **—** (excluded) |

**Checks:**
- #6 shows `—` in **Cross the Ocean** and **Gut Check** (the two activities it didn't fully complete).
- In Cross the Ocean, #1 and #3 tie for 1st but both display **"2nd"** (round-half-up). Same for #2/#3 in Splash Zone.
- Click an activity **column header** → table re-sorts by that activity's rank (excluded teams sink to the bottom). Click again → resets to default. A *"Sorted by … rank"* note appears.

### F2 — Cohort filter is a VIEW filter only
- Click **Cohort 1** → only #1/#2/#3 rows show. Click **Cohort 2** → only #4/#5/#6.
- **Expected:** the per-activity rank numbers **do not change** — they remain the
  global ranks computed across all 6 teams (e.g. #5 still shows "2nd" in Gut
  Check even when only cohort 2 is visible). Cohorts **filter rows, they do not
  re-rank**. Click **All** to restore.

---

## Phase G — Finalize & verify FINAL results

1. Event page → **Finalize**.
2. First check the **finalization gaps** report (the finalize screen / `GET .../finalize`).
   **Expected gaps:** #6 Narwhals is missing **Cross the Ocean** and **Gut Check
   → Measurement Test**. (Finalizing anyway is allowed; missing scores → 0 points there.)
3. Confirm finalize.

**Expected status after finalize:**
- Event shows **locked** and **finalized**.
- Leaderboard title flips to **"Final Results — QA Field Day"**; subtitle gone.
- A **"Total"** column appears; **Rank** column now populated.
- Each activity cell shows **points (large)** over **rank (small ordinal)**.
- Default sort = by overall rank (highest total first).

**Expected FINAL board** (display order; each activity cell = `points` / displayed rank):

| Rank | Team | Cross the Ocean | Team Slingshot | Splash Zone | Gut Check | **Total** |
|---|---|---|---|---|---|---|
| **2nd** | #1 Sharks | **5.5** / 2nd | **4** / 3rd | **3** / 4th | **6** / 1st | **18.5** |
| **2nd** | #2 Dolphins | **4** / 3rd | **6** / 1st | **5.5** / 2nd | **3** / 4th | **18.5** |
| **4th** | #3 Krakens | **5.5** / 2nd | **2** / 5th | **5.5** / 2nd | **4** / 3rd | **17** |
| **4th** | #5 Penguins | **3** / 4th | **5** / 2nd | **4** / 3rd | **5** / 2nd | **17** |
| **5th** | #4 Otters | **2** / 5th | **3** / 4th | **1** / 6th | **2** / 5th | **8** |
| **6th** | #6 Narwhals | **0** / — | **1** / 6th | **2** / 5th | **0** / — | **3** |

**Key things to verify:**
- **#1 and #2 are tied for 1st overall** (total 18.5 each) but both display
  **"2nd"** in the Rank column (round-half-up of global rank 1.5). **No row shows "1st".**
- **#3 and #5 tie** at total 17 → both display **"4th"** (global rank 3.5).
- **#6's excluded activities show points 0 and rank `—`** (Cross the Ocean, Gut
  Check) — those zeros drag its total to 3, dead last.
- Totals are exact: 18.5, 18.5, 17, 17, 8, 3. (Sum check: every activity awards
  `1+2+3+4+5+6 = 21` points minus what's lost to exclusions; here two teams were
  excluded from one activity each, so total points distributed = 21+21+21+21
  − (the 0s) … just confirm each row's four cells add to its Total.)
- Cohort filter still works on the final board and still does **not** re-rank.

### G2 — Public board parity
Open the **public** event page (`/public/events/[id]`). Same numbers, dark
theme, team names not links. Confirm it matches the admin final board.

---

## Phase H — Locked-event guardrails (negative tests)

With the event finalized (= locked):
1. Try to log/edit any score → **Expected:** rejected, *"Event is locked"* (HTTP 400). UI should block or error.
2. Try to add an activity from a template → **Expected:** *"Event is locked"*.
3. Try to add/import a team → still allowed by API (teams aren't gated on lock) — note current behavior; flag if undesired.

---

## Phase I — Unlock & re-finalize (reversibility)

1. Event page → **Unlock**.
2. **Expected:** event no longer locked/finalized; leaderboard reverts to
   **"Live Standings"**, Total/Rank columns disappear, live per-activity ranks
   return exactly as in **Phase F**.
3. Edit one score (e.g. set **#6 Narwhals Cross the Ocean = 40**). Now #6 has the
   fastest time → in Cross the Ocean live ranks, **#6 = 1st**, and #1/#3 shift to
   tied 2nd/3rd (rank 2.5 → display "3rd"). Confirm the board updates live
   (PubNub) without a manual refresh if configured.
4. Re-finalize → totals recompute (#6 now earns Cross the Ocean points and is no
   longer excluded there). Confirm the snapshot reflects the new scores. *(Optional:
   you can revert that edit and re-finalize to return to the canonical board above.)*

---

## Optional Test J — abs_deviation_from_target (custom activity)

No seeded template uses `abs_deviation_from_target`, so to cover it create a
**custom activity**:
- Activities → add custom → 1 sub-activity, input rule **abs_deviation_from_target**,
  sort **asc**, one field with **target = 0**.
- Enter values: #1 = `-7`, #2 = `5`, #3 = `3`.
- **Expected computed:** `|−7−0|=7`, `5`, `3`. Ranks (closest to 0 wins, asc):
  #3 (3) = 1st, #2 (5) = 2nd, #1 (7) = 3rd. (Unlike the deviation rule, a target
  of **0 is allowed** here.)

---

## Coverage matrix (what this plan exercises)

| Capability | Where |
|---|---|
| `single_value`, asc | Cross the Ocean, Team Slingshot |
| `single_value`, desc | Splash Zone |
| `sum_of_pct_deviation` (+ default targets) | Gut Check / Timer Test |
| `sum_of_pct_deviation` (+ manually-set targets) | Gut Check / Weight & Measurement |
| `abs_deviation_from_target` | Optional Test J |
| `single` aggregation | Ocean, Slingshot, Splash |
| `sum_of_ranks` aggregation | Gut Check |
| Two-way ties (averaged rank/points) | Ocean (#1/#3), Splash (#2/#3), overall (#1/#2, #3/#5) |
| Multi-way sub-activity tie | Gut Check / Weight Test (#3/#4/#5/#6 = rank 3.5) |
| Coverage-gap exclusion → 0 pts | #6 in Ocean and Gut Check |
| Points = (N+1)−rank | All activities, N=6 |
| Global rank from summed points | Final board Total/Rank |
| Display round-half-up quirk | Ocean, Splash, overall ranks |
| CSV import (teams/roster/cohort) | Phase C |
| CSV error reporting + empty-team rows | Phase C2 |
| Cohort filter is view-only | Phase F2 |
| Live vs finalized board states | Phases F vs G |
| Locked-event write guards | Phase H |
| Unlock / re-finalize reversibility + live updates | Phase I |
| Pure engine unit + scenario tests | Phase A |

---

## Reset between runs

```bash
# wipe just this event's data via the admin UI (delete the event — cascades to
# teams/activities/scores), OR reset the scratch DB entirely:
npm run db:push -- --force-reset      # destructive: drops all data, re-applies schema
SEED_ADMIN_EMAIL=admin@test.dev SEED_ADMIN_PASSWORD=test123 npm run db:seed
```
