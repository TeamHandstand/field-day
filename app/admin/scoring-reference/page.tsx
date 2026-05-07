export default function ScoringReferencePage() {
  return (
    <article className="prose max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold">Scoring reference</h1>
      <p className="text-slate-600">
        How a raw input becomes a number on the scoreboard. Use this page to explain
        scoring to teammates, hosts, and players — it always reflects the live rules.
      </p>

      <section className="card space-y-2">
        <h2 className="text-xl font-semibold">1. From raw inputs to a computed value</h2>
        <p>Every sub-activity has an <em>input rule</em>:</p>
        <ul className="ml-5 list-disc space-y-1 text-sm">
          <li>
            <strong>single_value</strong> — one number per team (a time, a weight, a count). The number is the score.
          </li>
          <li>
            <strong>sum_of_pct_deviation</strong> — multiple targets, multiple attempts.
            For each attempt: <code>|attempt − target| ÷ target × 100</code>. The percentages are added together.
            Lower total is better. Example: targets 30, 60, 90; attempts 33, 54, 99 → 10% + 10% + 10% = 30.
          </li>
          <li>
            <strong>abs_deviation_from_target</strong> — one input, one target. The score is{" "}
            <code>|input − target|</code>. Useful when the target is zero (e.g., degrees off true North).
          </li>
        </ul>
      </section>

      <section className="card space-y-2">
        <h2 className="text-xl font-semibold">2. From computed values to a sub-activity rank</h2>
        <p>
          Within a sub-activity, teams are ranked by their computed value. The sort direction —
          <strong> asc</strong> (lower better) or <strong>desc</strong> (higher better) — is set per sub-activity.
        </p>
        <p>
          <strong>Ties get averaged ranks.</strong> Two teams tied for 3rd both receive 3.5.
          Three teams tied for 5th all receive 6 (the average of 5, 6, and 7).
        </p>
      </section>

      <section className="card space-y-2">
        <h2 className="text-xl font-semibold">3. From sub-activity ranks to an activity rank</h2>
        <ul className="ml-5 list-disc space-y-1 text-sm">
          <li>
            <strong>single</strong> — the activity has one sub-activity. Activity rank = sub-activity rank.
          </li>
          <li>
            <strong>sum_of_ranks</strong> — for each team, sum their sub-activity ranks.
            Re-rank teams by that sum, lowest sum = 1st place. Ties at this stage also use averaged ranks.
          </li>
        </ul>
      </section>

      <section className="card space-y-2">
        <h2 className="text-xl font-semibold">4. From activity ranks to points</h2>
        <p>
          Points are stamped only when the admin ends the event. With <strong>N</strong> teams in the event:
        </p>
        <p className="rounded bg-slate-100 p-2 text-center font-mono">points = (N + 1) − rank</p>
        <p>
          So in a 14-team event, 1st = 14 points and last = 1 point. Ties at any rank stage get averaged points
          (because their ranks are averaged too).
        </p>
      </section>

      <section className="card space-y-2">
        <h2 className="text-xl font-semibold">5. Missing scores</h2>
        <p>
          If a team is missing any sub-activity score for an activity, the team is excluded from that
          activity's ranking and earns <strong>0 points</strong> for it. Other teams rank 1 through k;
          their points still scale to N (so 1st still earns N points).
        </p>
      </section>

      <section className="card space-y-2">
        <h2 className="text-xl font-semibold">6. Cohort vs global</h2>
        <p>
          Cohort ranks are calculated independently of the global ranks — useful for in-the-moment
          announcements ("Cohort 3, you're in 1st place right now!"). Cohort filtering is available
          on every leaderboard view.
        </p>
      </section>
    </article>
  );
}
