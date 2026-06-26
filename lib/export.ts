// Flat CSV export of every event's full scoring data: one row per
// (event, team, activity, sub-activity, input field). Rows are emitted even when
// a team has no score for a sub-activity so the export reflects the complete
// matrix (gaps show up as blank recorded values). Where a field carries a target,
// the target and the team's signed deviation from it are included.

import type { LeaderboardData } from "./leaderboard";

export const EXPORT_HEADERS = [
  "Event",
  "Event Status",
  "Team #",
  "Team",
  "Cohort",
  "Activity",
  "Sub-Activity",
  "Input Field",
  "Unit",
  "Recorded Value",
  "Target",
  "Deviation",
  "Computed Score",
  "Sub-Activity Rank",
  "Activity Rank",
  "Activity Points",
  "Overall Total",
  "Overall Rank",
] as const;

// Quote a CSV cell when it contains a comma, quote, or newline; double any
// embedded quotes. Always returns a string.
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(headers: readonly string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((cols) => cols.map(csvEscape).join(","));
  return lines.join("\r\n");
}

// Trim floating-point noise without forcing a fixed precision: round to 4
// decimals then drop trailing zeros. Null/undefined become an empty cell.
function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  const rounded = Math.round(n * 1e4) / 1e4;
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toString();
}

function eventStatus(ev: LeaderboardData["event"]): string {
  if (ev.isFinalized) return "Finalized";
  if (ev.isLocked) return "Locked";
  return "In progress";
}

// Flatten one or more loaded leaderboards into CSV data rows (header-aligned).
export function buildExportRows(boards: LeaderboardData[]): string[][] {
  const rows: string[][] = [];

  for (const board of boards) {
    const finalized = board.event.isFinalized ? board.finalized : null;
    const status = eventStatus(board.event);

    // Fast lookup of a team's score for a given sub-activity.
    const scoreByKey = new Map<string, LeaderboardData["scores"][number]>();
    for (const s of board.scores) {
      scoreByKey.set(`${s.teamId}::${s.subActivityId}`, s);
    }

    const activityRankFor = (teamId: string, activityId: string): number | undefined =>
      finalized
        ? finalized.activities.find((a) => a.activityId === activityId)?.activityRanks[teamId]
        : board.liveActivityRanks[activityId]?.[teamId];

    const activityPointsFor = (teamId: string, activityId: string): number | undefined =>
      finalized
        ? finalized.activities.find((a) => a.activityId === activityId)?.points[teamId]
        : undefined; // points are only awarded at finalization

    const overallTotalFor = (teamId: string): number | undefined =>
      finalized ? finalized.totals[teamId] : board.liveStandings.totals[teamId];
    const overallRankFor = (teamId: string): number | undefined =>
      finalized ? finalized.globalRanks[teamId] : board.liveStandings.globalRanks[teamId];

    for (const team of board.teams) {
      const overallTotal = fmtNum(overallTotalFor(team.id));
      const overallRank = fmtNum(overallRankFor(team.id));
      const cohort = team.cohortNumber != null ? String(team.cohortNumber) : "";

      for (const activity of board.activities) {
        const activityRank = fmtNum(activityRankFor(team.id, activity.id));
        const activityPoints = fmtNum(activityPointsFor(team.id, activity.id));

        for (const sub of activity.subActivities) {
          const score = scoreByKey.get(`${team.id}::${sub.id}`);
          const computed = score ? fmtNum(score.computedValue) : "";
          const subRank = fmtNum(board.liveSubActivityRanks[sub.id]?.[team.id]);
          const rawByField = new Map<string, number>(
            (score?.inputs ?? []).map((i) => [i.inputFieldId, i.rawValue]),
          );

          // A sub-activity always has at least one input field; emit one row per
          // field so multi-attempt sub-activities (e.g. Gut Check timer attempts)
          // get a target/deviation per attempt.
          const fields = sub.inputFields.length > 0 ? sub.inputFields : [null];
          for (const field of fields) {
            const recorded = field ? rawByField.get(field.id) : undefined;
            const target = field?.targetValue ?? null;
            const deviation =
              recorded != null && target != null ? recorded - target : null;

            rows.push([
              board.event.name,
              status,
              String(team.teamNumber),
              team.name,
              cohort,
              activity.name,
              sub.name,
              field?.label ?? "",
              field?.unit ?? "",
              fmtNum(recorded),
              fmtNum(target),
              fmtNum(deviation),
              computed,
              subRank,
              activityRank,
              activityPoints,
              overallTotal,
              overallRank,
            ]);
          }
        }
      }
    }
  }

  return rows;
}

// Load every event (or a single one) and produce the full-data CSV string.
// DB modules are imported lazily so the pure helpers above stay free of the
// Prisma client (and are unit-testable without a generated client).
export async function generateExportCsv(eventId?: string): Promise<string> {
  const { prisma } = await import("./prisma");
  const { loadLeaderboard } = await import("./leaderboard");

  const events = eventId
    ? [{ id: eventId }]
    : await prisma.event.findMany({ orderBy: { createdAt: "asc" }, select: { id: true } });

  const boards: LeaderboardData[] = [];
  for (const ev of events) {
    const board = await loadLeaderboard(ev.id);
    if (board) boards.push(board);
  }

  return toCsv(EXPORT_HEADERS, buildExportRows(boards));
}
