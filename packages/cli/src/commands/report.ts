import { select } from "@inquirer/prompts";
import { listSessionsInRange, listAllSessions } from "../db.js";
import { extractProject } from "@getpromptly/shared";
import type { DbSession } from "../db.js";

export async function reportCommand(options: {
  from?: string;
  to?: string;
  period?: string;
}) {
  // Interactive period selector if no options provided
  if (!options.from && !options.to && !options.period) {
    const period = await select({
      message: "Select time period:",
      choices: [
        { name: "Today", value: "today" },
        { name: "Last 7 days", value: "week" },
        { name: "Last 30 days", value: "month" },
        { name: "Last year", value: "year" },
        { name: "All time", value: "all" },
      ],
    });
    if (period !== "all") {
      options.period = period;
    }
  }

  const { from, to } = resolveRange(options);
  const sessions = from && to ? listSessionsInRange(from, to) : listAllSessions();

  if (sessions.length === 0) {
    console.log("No sessions found for this period.");
    return;
  }

  const completed = sessions.filter((s) => s.status === "COMPLETED");
  const totalTokens = sum(sessions, (s) => s.total_tokens);
  const promptTokens = sum(sessions, (s) => s.prompt_tokens);
  const responseTokens = sum(sessions, (s) => s.response_tokens);
  const totalMessages = sum(sessions, (s) => s.message_count);
  const totalToolCalls = sum(sessions, (s) => s.tool_call_count);

  // Duration stats (completed sessions only)
  const durations = completed
    .filter((s) => s.finished_at)
    .map(
      (s) =>
        (new Date(s.finished_at!).getTime() - new Date(s.started_at).getTime()) / 60000
    );
  const avgDuration =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

  // Models used
  const modelSet = new Set<string>();
  sessions.forEach((s) => {
    JSON.parse(s.models || "[]").forEach((m: string) => modelSet.add(m));
  });

  // Tools used
  const toolCounts: Record<string, number> = {};
  sessions.forEach((s) => {
    if (s.client_tool) {
      toolCounts[s.client_tool] = (toolCounts[s.client_tool] || 0) + 1;
    }
  });

  // Tags
  const tagCounts: Record<string, number> = {};
  sessions.forEach((s) => {
    JSON.parse(s.tags || "[]").forEach((t: string) => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });

  const label = from && to ? `${from.slice(0, 10)} to ${to.slice(0, 10)}` : "All time";

  console.log(`\n  Promptly Report — ${label}\n`);
  console.log(`  Sessions:         ${sessions.length} total, ${completed.length} completed`);
  console.log(`  Total tokens:     ${totalTokens.toLocaleString()} (${promptTokens.toLocaleString()} prompt, ${responseTokens.toLocaleString()} response)`);
  console.log(`  Messages:         ${totalMessages.toLocaleString()}`);
  console.log(`  Tool calls:       ${totalToolCalls.toLocaleString()}`);
  console.log(`  Avg duration:     ${avgDuration}m`);
  console.log(`  Avg tokens/sess:  ${sessions.length > 0 ? Math.round(totalTokens / sessions.length).toLocaleString() : 0}`);

  if (modelSet.size > 0) {
    console.log(`  Models:           ${[...modelSet].join(", ")}`);
  }
  if (Object.keys(toolCounts).length > 0) {
    const tools = Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `${t} (${c})`)
      .join(", ");
    console.log(`  AI tools:         ${tools}`);
  }
  if (Object.keys(tagCounts).length > 0) {
    const tags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `${t} (${c})`)
      .join(", ");
    console.log(`  Tags:             ${tags}`);
  }

  // Git stats
  let totalCommits = 0, totalInsertions = 0, totalDeletions = 0;
  sessions.forEach((s) => {
    if (s.git_activity) {
      try {
        const ga = JSON.parse(s.git_activity);
        totalCommits += ga.totalCommits ?? 0;
        totalInsertions += ga.totalInsertions ?? 0;
        totalDeletions += ga.totalDeletions ?? 0;
      } catch {
        // ignore malformed git_activity
      }
    }
  });
  if (totalCommits > 0) {
    console.log(`  Git commits:      ${totalCommits} (+${totalInsertions}/-${totalDeletions} lines)`);
  }

  // By Category
  const categoryCounts: Record<string, number> = {};
  sessions.forEach((s) => {
    const cat = s.category || "uncategorized";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });
  if (Object.keys(categoryCounts).length > 0) {
    const categories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c} (${n})`)
      .join(", ");
    console.log(`  By category:      ${categories}`);
  }

  // By Project
  const projectStats: Record<string, { sessions: number; tokens: number }> = {};
  sessions.forEach((s) => {
    const project = extractProject(s.ticket_id);
    if (project) {
      if (!projectStats[project]) {
        projectStats[project] = { sessions: 0, tokens: 0 };
      }
      projectStats[project].sessions++;
      projectStats[project].tokens += s.total_tokens;
    }
  });
  if (Object.keys(projectStats).length > 0) {
    console.log(`  By project:`);
    const sorted = Object.entries(projectStats).sort((a, b) => b[1].tokens - a[1].tokens);
    for (const [project, stats] of sorted) {
      console.log(`    ${project.padEnd(20)} ${stats.sessions} sessions, ${stats.tokens.toLocaleString()} tokens`);
    }
  }

  console.log();
}

function resolveRange(options: { from?: string; to?: string; period?: string }): {
  from: string | undefined;
  to: string | undefined;
} {
  if (options.from || options.to) {
    const from = options.from
      ? new Date(options.from).toISOString()
      : undefined;
    const to = options.to
      ? new Date(options.to).toISOString()
      : new Date().toISOString();
    return { from, to };
  }

  if (options.period) {
    const now = new Date();
    const to = now.toISOString();
    let from: Date;

    switch (options.period) {
      case "today":
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "week":
        from = new Date(now);
        from.setDate(from.getDate() - 7);
        break;
      case "month":
        from = new Date(now);
        from.setMonth(from.getMonth() - 1);
        break;
      case "year":
        from = new Date(now);
        from.setFullYear(from.getFullYear() - 1);
        break;
      default:
        console.error(`Unknown period: ${options.period}. Use today, week, month, or year.`);
        process.exit(1);
    }

    return { from: from.toISOString(), to };
  }

  return { from: undefined, to: undefined };
}

function sum(sessions: DbSession[], fn: (s: DbSession) => number): number {
  return sessions.reduce((acc, s) => acc + fn(s), 0);
}
