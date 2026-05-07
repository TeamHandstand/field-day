import { prisma } from "./prisma";
import {
  finalize,
  rankActivity,
  rankWithAveragedTies,
  type ActivityShape,
  type SubActivityScore,
} from "./scoring";

export type LeaderboardData = {
  event: {
    id: string;
    name: string;
    isLocked: boolean;
    isFinalized: boolean;
    finalizedAt: string | null;
  };
  teams: {
    id: string;
    name: string;
    teamNumber: number;
    cohortNumber: number | null;
    photoUrl: string | null;
  }[];
  activities: {
    id: string;
    name: string;
    aggregationRule: "single" | "sum_of_ranks";
    description: string;
    subActivities: {
      id: string;
      name: string;
      inputRule: "single_value" | "sum_of_pct_deviation" | "abs_deviation_from_target";
      sortDirection: "asc" | "desc";
      inputFields: { id: string; label: string; unit: string; targetValue: number | null }[];
    }[];
  }[];
  scores: {
    teamId: string;
    activityId: string;
    subActivityId: string;
    computedValue: number;
  }[];
  // Live (pre-finalization) per-activity rank for each team that has full coverage.
  liveActivityRanks: Record<string /* activityId */, Record<string /* teamId */, number>>;
  liveSubActivityRanks: Record<string /* subActivityId */, Record<string /* teamId */, number>>;
  finalized: {
    totalTeams: number;
    activities: {
      activityId: string;
      activityRanks: Record<string, number>;
      excluded: string[];
      points: Record<string, number>;
    }[];
    totals: Record<string, number>;
    globalRanks: Record<string, number>;
  } | null;
};

export async function loadLeaderboard(eventId: string): Promise<LeaderboardData | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      teams: {
        orderBy: { teamNumber: "asc" },
        include: { photos: { orderBy: { displayOrder: "asc" }, take: 1 } },
      },
      activities: {
        orderBy: { displayOrder: "asc" },
        include: {
          subActivities: {
            orderBy: { displayOrder: "asc" },
            include: {
              inputFields: { orderBy: { displayOrder: "asc" } },
              scoreEntries: true,
            },
          },
        },
      },
    },
  });
  if (!event) return null;

  const teams = event.teams.map((t) => ({
    id: t.id,
    name: t.name,
    teamNumber: t.teamNumber,
    cohortNumber: t.cohortNumber,
    photoUrl: t.photos[0]?.cloudinaryUrl ?? null,
  }));

  const allTeamIds = teams.map((t) => t.id);

  const activities = event.activities.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description ?? "",
    aggregationRule: a.aggregationRule,
    subActivities: a.subActivities.map((s) => ({
      id: s.id,
      name: s.name,
      inputRule: s.inputRule,
      sortDirection: s.sortDirection,
      inputFields: s.inputFields.map((f) => ({
        id: f.id,
        label: f.label,
        unit: f.unit,
        targetValue: f.targetValue,
      })),
    })),
  }));

  const scores: LeaderboardData["scores"] = [];
  const subToActivity = new Map<string, string>();
  for (const a of event.activities) {
    for (const s of a.subActivities) {
      subToActivity.set(s.id, a.id);
      for (const e of s.scoreEntries) {
        scores.push({
          teamId: e.teamId,
          activityId: a.id,
          subActivityId: s.id,
          computedValue: e.computedValue,
        });
      }
    }
  }

  // Live ranks (pre-finalization).
  const liveActivityRanks: Record<string, Record<string, number>> = {};
  const liveSubActivityRanks: Record<string, Record<string, number>> = {};

  const scoresByActivity = new Map<string, SubActivityScore[]>();
  for (const s of scores) {
    if (!scoresByActivity.has(s.activityId)) scoresByActivity.set(s.activityId, []);
    scoresByActivity.get(s.activityId)!.push({
      subActivityId: s.subActivityId,
      teamId: s.teamId,
      computedValue: s.computedValue,
    });
  }

  for (const a of activities) {
    const shape: ActivityShape = {
      id: a.id,
      aggregationRule: a.aggregationRule,
      subActivities: a.subActivities.map((s) => ({
        id: s.id,
        inputRule: s.inputRule,
        sortDirection: s.sortDirection,
        inputFields: s.inputFields.map((f) => ({ id: f.id, targetValue: f.targetValue })),
      })),
    };
    const r = rankActivity(shape, scoresByActivity.get(a.id) ?? [], allTeamIds);
    liveActivityRanks[a.id] = Object.fromEntries(r.ranks);
    for (const [sid, m] of r.subActivityRanks) {
      liveSubActivityRanks[sid] = Object.fromEntries(m);
    }

    // For single-aggregation, rankActivity already filled subActivityRanks.
    // For activities with no full coverage, also expose individual subRanks for
    // display purposes (rankActivity does include them either way).
  }

  const finalizedSnap =
    event.isFinalized && event.finalizedSnapshot
      ? (event.finalizedSnapshot as unknown as {
          totalTeams: number;
          activities: {
            activityId: string;
            activityRanks: Record<string, number>;
            excluded: string[];
            points: Record<string, number>;
          }[];
          totals: Record<string, number>;
          globalRanks: Record<string, number>;
        })
      : null;

  return {
    event: {
      id: event.id,
      name: event.name,
      isLocked: event.isLocked,
      isFinalized: event.isFinalized,
      finalizedAt: event.finalizedAt ? event.finalizedAt.toISOString() : null,
    },
    teams,
    activities,
    scores,
    liveActivityRanks,
    liveSubActivityRanks,
    finalized: finalizedSnap,
  };
}

export async function finalizeEvent(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      teams: true,
      activities: {
        include: {
          subActivities: {
            include: { inputFields: true, scoreEntries: true },
          },
        },
      },
    },
  });
  if (!event) throw new Error("Event not found");

  const allTeamIds = event.teams.map((t) => t.id);
  const activities: ActivityShape[] = event.activities.map((a) => ({
    id: a.id,
    aggregationRule: a.aggregationRule,
    subActivities: a.subActivities.map((s) => ({
      id: s.id,
      inputRule: s.inputRule,
      sortDirection: s.sortDirection,
      inputFields: s.inputFields.map((f) => ({ id: f.id, targetValue: f.targetValue })),
    })),
  }));
  const scoresByActivity = new Map<string, SubActivityScore[]>();
  for (const a of event.activities) {
    const list: SubActivityScore[] = [];
    for (const s of a.subActivities) {
      for (const e of s.scoreEntries) {
        list.push({ subActivityId: s.id, teamId: e.teamId, computedValue: e.computedValue });
      }
    }
    scoresByActivity.set(a.id, list);
  }

  const snapshot = finalize(activities, scoresByActivity, allTeamIds);
  const updated = await prisma.event.update({
    where: { id: eventId },
    data: {
      isLocked: true,
      isFinalized: true,
      lockedAt: new Date(),
      finalizedAt: new Date(),
      finalizedSnapshot: snapshot as unknown as object,
    },
  });
  return { event: updated, snapshot };
}

export type GapReport = {
  teamId: string;
  teamName: string;
  teamNumber: number;
  missing: { activityId: string; activityName: string; subActivityIds: string[] }[];
};

export async function reportFinalizationGaps(eventId: string): Promise<GapReport[]> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      teams: { orderBy: { teamNumber: "asc" } },
      activities: {
        include: { subActivities: { include: { scoreEntries: true } } },
      },
    },
  });
  if (!event) return [];
  const out: GapReport[] = [];
  for (const team of event.teams) {
    const missing: GapReport["missing"] = [];
    for (const a of event.activities) {
      const missingSubs: string[] = [];
      for (const s of a.subActivities) {
        const has = s.scoreEntries.some((e) => e.teamId === team.id);
        if (!has) missingSubs.push(s.id);
      }
      if (missingSubs.length > 0) {
        missing.push({ activityId: a.id, activityName: a.name, subActivityIds: missingSubs });
      }
    }
    if (missing.length > 0) {
      out.push({ teamId: team.id, teamName: team.name, teamNumber: team.teamNumber, missing });
    }
  }
  return out;
}
