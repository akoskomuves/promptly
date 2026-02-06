import type {
  DigestSessionInput,
  DigestPeriodMetrics,
  DigestComparison,
  DigestTopProject,
  DigestDeveloperEfficiency,
  WeeklyDigest,
} from "./types.js";
import { extractProject } from "./categorize.js";

/**
 * Get ISO week boundaries (Monday–Sunday) for the current and previous periods.
 */
export function getWeekBoundaries(referenceDate?: Date): {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
} {
  const ref = referenceDate ?? new Date();
  // Find the Monday of the current week
  const day = ref.getDay(); // 0=Sun, 1=Mon, ...
  const diffToMonday = day === 0 ? 6 : day - 1;

  const currentStart = new Date(ref);
  currentStart.setDate(ref.getDate() - diffToMonday);
  currentStart.setHours(0, 0, 0, 0);

  const currentEnd = new Date(currentStart);
  currentEnd.setDate(currentStart.getDate() + 7);
  // currentEnd is start of next Monday (exclusive)

  const previousStart = new Date(currentStart);
  previousStart.setDate(currentStart.getDate() - 7);

  const previousEnd = new Date(currentStart); // same as current start

  return { currentStart, currentEnd, previousStart, previousEnd };
}

/**
 * Get custom date range boundaries with a previous period of equal length.
 */
export function getCustomBoundaries(from: Date, to: Date): {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
} {
  const duration = to.getTime() - from.getTime();
  const previousStart = new Date(from.getTime() - duration);
  const previousEnd = new Date(from);
  return {
    currentStart: from,
    currentEnd: to,
    previousStart,
    previousEnd,
  };
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function formatDateRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startStr = start.toLocaleDateString("en-US", opts);
  // end is exclusive, so subtract 1 day for display
  const endDisplay = new Date(end);
  endDisplay.setDate(endDisplay.getDate() - 1);
  const endStr = endDisplay.toLocaleDateString("en-US", {
    ...opts,
    year: "numeric",
  });
  return `${startStr} – ${endStr}`;
}

/**
 * Compute aggregate metrics for a set of sessions.
 */
export function computePeriodMetrics(
  sessions: DigestSessionInput[]
): DigestPeriodMetrics {
  const completed = sessions.filter((s) => s.status === "COMPLETED");
  const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);
  const totalCost = sessions.reduce(
    (sum, s) => sum + (s.costEstimate ?? 0),
    0
  );

  // Duration (completed only)
  const durations = completed
    .filter((s) => s.finishedAt)
    .map(
      (s) =>
        (new Date(s.finishedAt!).getTime() - new Date(s.startedAt).getTime()) /
        60000
    );
  const avgDuration =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

  // Quality
  let qualitySum = 0;
  let qualityCount = 0;
  for (const s of sessions) {
    if (s.intelligence?.qualityScore?.overall != null) {
      qualitySum += s.intelligence.qualityScore.overall;
      qualityCount++;
    }
  }
  const avgQuality =
    qualityCount > 0
      ? Math.round((qualitySum / qualityCount) * 10) / 10
      : null;

  // Git
  let totalCommits = 0;
  let totalInsertions = 0;
  let totalDeletions = 0;
  for (const s of sessions) {
    if (s.gitActivity) {
      totalCommits += s.gitActivity.totalCommits ?? 0;
      totalInsertions += s.gitActivity.totalInsertions ?? 0;
      totalDeletions += s.gitActivity.totalDeletions ?? 0;
    }
  }

  return {
    totalSessions: sessions.length,
    completedSessions: completed.length,
    totalTokens,
    totalMessages,
    totalCost: Math.round(totalCost * 100) / 100,
    avgDuration,
    avgQuality,
    totalCommits,
    totalInsertions,
    totalDeletions,
  };
}

/**
 * Main entry point: compute the full weekly digest from a set of sessions.
 */
export function computeWeeklyDigest(
  allSessions: DigestSessionInput[],
  referenceDate?: Date,
  customRange?: { from: Date; to: Date }
): WeeklyDigest {
  const bounds = customRange
    ? getCustomBoundaries(customRange.from, customRange.to)
    : getWeekBoundaries(referenceDate);

  const { currentStart, currentEnd, previousStart, previousEnd } = bounds;

  // Split sessions into current and previous periods
  const currentSessions = allSessions.filter((s) => {
    const t = new Date(s.startedAt).getTime();
    return t >= currentStart.getTime() && t < currentEnd.getTime();
  });
  const previousSessions = allSessions.filter((s) => {
    const t = new Date(s.startedAt).getTime();
    return t >= previousStart.getTime() && t < previousEnd.getTime();
  });

  const current = computePeriodMetrics(currentSessions);
  const previous = computePeriodMetrics(previousSessions);

  const changes = {
    sessions: percentChange(current.totalSessions, previous.totalSessions),
    tokens: percentChange(current.totalTokens, previous.totalTokens),
    cost: percentChange(current.totalCost, previous.totalCost),
    messages: percentChange(current.totalMessages, previous.totalMessages),
    quality:
      current.avgQuality != null && previous.avgQuality != null
        ? percentChange(current.avgQuality, previous.avgQuality)
        : null,
    commits: percentChange(current.totalCommits, previous.totalCommits),
  };

  const comparison: DigestComparison = { current, previous, changes };

  // Top projects (from current period)
  const projectMap = new Map<
    string,
    { sessions: number; tokens: number; cost: number }
  >();
  for (const s of currentSessions) {
    const project = extractProject(s.ticketId);
    if (!project) continue;
    const existing = projectMap.get(project);
    if (existing) {
      existing.sessions++;
      existing.tokens += s.totalTokens;
      existing.cost += s.costEstimate ?? 0;
    } else {
      projectMap.set(project, {
        sessions: 1,
        tokens: s.totalTokens,
        cost: s.costEstimate ?? 0,
      });
    }
  }
  const topProjects: DigestTopProject[] = Array.from(projectMap.entries())
    .map(([project, stats]) => ({
      project,
      ...stats,
      cost: Math.round(stats.cost * 100) / 100,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);

  // Developer breakdown (current period)
  const devMap = new Map<
    string,
    {
      name: string;
      sessions: number;
      totalTokens: number;
      totalCost: number;
      qualitySum: number;
      qualityCount: number;
    }
  >();
  for (const s of currentSessions) {
    const key = s.userEmail || s.userName || "local";
    const existing = devMap.get(key);
    const quality = s.intelligence?.qualityScore?.overall;
    if (existing) {
      existing.sessions++;
      existing.totalTokens += s.totalTokens;
      existing.totalCost += s.costEstimate ?? 0;
      if (quality != null) {
        existing.qualitySum += quality;
        existing.qualityCount++;
      }
    } else {
      devMap.set(key, {
        name: s.userName || s.userEmail || "local",
        sessions: 1,
        totalTokens: s.totalTokens,
        totalCost: s.costEstimate ?? 0,
        qualitySum: quality ?? 0,
        qualityCount: quality != null ? 1 : 0,
      });
    }
  }
  const developers: DigestDeveloperEfficiency[] = Array.from(devMap.values())
    .map((d) => ({
      name: d.name,
      sessions: d.sessions,
      tokensPerSession: d.sessions > 0 ? Math.round(d.totalTokens / d.sessions) : 0,
      costPerSession:
        d.sessions > 0
          ? Math.round((d.totalCost / d.sessions) * 100) / 100
          : 0,
      avgQuality:
        d.qualityCount > 0
          ? Math.round((d.qualitySum / d.qualityCount) * 10) / 10
          : null,
    }))
    .sort((a, b) => a.costPerSession - b.costPerSession);

  // Category breakdown (current period)
  const catMap = new Map<string, { sessions: number; tokens: number }>();
  for (const s of currentSessions) {
    const cat = s.category || "other";
    const existing = catMap.get(cat);
    if (existing) {
      existing.sessions++;
      existing.tokens += s.totalTokens;
    } else {
      catMap.set(cat, { sessions: 1, tokens: s.totalTokens });
    }
  }
  const topCategories = Array.from(catMap.entries())
    .map(([category, stats]) => ({ category, ...stats }))
    .sort((a, b) => b.sessions - a.sessions);

  // Generate highlights
  const highlights: string[] = [];

  if (changes.sessions != null && changes.sessions !== 0) {
    const dir = changes.sessions > 0 ? "up" : "down";
    highlights.push(
      `Sessions ${dir} ${Math.abs(changes.sessions)}% from last period`
    );
  }

  if (topProjects.length > 0) {
    const top = topProjects[0];
    highlights.push(
      `${top.project} was the busiest project (${top.sessions} session${top.sessions !== 1 ? "s" : ""})`
    );
  }

  if (
    current.avgQuality != null &&
    previous.avgQuality != null &&
    current.avgQuality !== previous.avgQuality
  ) {
    if (current.avgQuality > previous.avgQuality) {
      highlights.push(
        `Quality improved from ${previous.avgQuality} to ${current.avgQuality}`
      );
    } else {
      highlights.push(
        `Quality declined from ${previous.avgQuality} to ${current.avgQuality}`
      );
    }
  }

  if (current.totalCommits > 0) {
    highlights.push(
      `${current.totalCommits} commit${current.totalCommits !== 1 ? "s" : ""} (+${current.totalInsertions}/-${current.totalDeletions} lines)`
    );
  }

  if (changes.tokens != null && Math.abs(changes.tokens) >= 20) {
    const dir = changes.tokens > 0 ? "up" : "down";
    highlights.push(
      `Token usage ${dir} ${Math.abs(changes.tokens)}%`
    );
  }

  return {
    periodLabel: formatDateRange(currentStart, currentEnd),
    previousLabel: formatDateRange(previousStart, previousEnd),
    comparison,
    topProjects,
    developers,
    topCategories,
    highlights,
  };
}
