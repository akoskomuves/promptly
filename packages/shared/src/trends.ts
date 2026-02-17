import type { ProjectCostTrend } from "./types.js";
import { extractProject } from "./categorize.js";

interface TrendSessionInput {
  ticketId: string;
  startedAt: string;
  totalTokens: number;
  promptTokens: number;
  responseTokens: number;
  costEstimate?: number;
}

/**
 * Compute project cost trends over time.
 * Groups sessions by project, buckets into weekly periods,
 * computes cost per period, and determines trend direction.
 */
export function computeProjectCostTrends(
  sessions: TrendSessionInput[],
  periodCount = 4,
  periodDays = 7
): ProjectCostTrend[] {
  if (sessions.length === 0) return [];

  // Find the most recent session date to anchor periods
  const latest = sessions.reduce((max, s) => {
    const t = new Date(s.startedAt).getTime();
    return t > max ? t : max;
  }, 0);

  // Build period boundaries (most recent first)
  const periods: { label: string; start: number; end: number }[] = [];
  for (let i = 0; i < periodCount; i++) {
    const end = new Date(latest);
    end.setDate(end.getDate() - i * periodDays);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - periodDays + 1);
    start.setHours(0, 0, 0, 0);

    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    const label = `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}`;
    periods.unshift({ label, start: start.getTime(), end: end.getTime() });
  }

  // Group sessions by project
  const projectSessions = new Map<string, TrendSessionInput[]>();
  for (const s of sessions) {
    const project = extractProject(s.ticketId);
    if (!project) continue;
    const existing = projectSessions.get(project);
    if (existing) {
      existing.push(s);
    } else {
      projectSessions.set(project, [s]);
    }
  }

  // Compute trends per project
  const trends: ProjectCostTrend[] = [];

  for (const [project, projSessions] of projectSessions) {
    const periodData = periods.map((p) => {
      const inPeriod = projSessions.filter((s) => {
        const t = new Date(s.startedAt).getTime();
        return t >= p.start && t <= p.end;
      });
      const cost = inPeriod.reduce((sum, s) => sum + (s.costEstimate ?? 0), 0);
      const tokens = inPeriod.reduce((sum, s) => sum + s.totalTokens, 0);
      return {
        label: p.label,
        startDate: new Date(p.start).toISOString(),
        cost: Math.round(cost * 100) / 100,
        tokens,
        sessions: inPeriod.length,
      };
    });

    const totalCost = periodData.reduce((sum, p) => sum + p.cost, 0);

    // Determine trend direction using first and last non-zero periods
    const nonZero = periodData.filter((p) => p.tokens > 0);
    let trendDirection: "rising" | "falling" | "stable" = "stable";
    let changePercent: number | null = null;

    if (nonZero.length >= 2) {
      const first = nonZero[0].tokens;
      const last = nonZero[nonZero.length - 1].tokens;
      if (first > 0) {
        changePercent = Math.round(((last - first) / first) * 100);
        if (changePercent > 10) trendDirection = "rising";
        else if (changePercent < -10) trendDirection = "falling";
      }
    }

    trends.push({
      project,
      periods: periodData,
      totalCost: Math.round(totalCost * 100) / 100,
      trendDirection,
      changePercent,
    });
  }

  // Sort by total tokens descending
  trends.sort((a, b) => {
    const aTokens = a.periods.reduce((s, p) => s + p.tokens, 0);
    const bTokens = b.periods.reduce((s, p) => s + p.tokens, 0);
    return bTokens - aTokens;
  });

  return trends;
}
