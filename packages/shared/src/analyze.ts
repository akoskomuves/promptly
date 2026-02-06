import type {
  SessionIntelligence,
  SessionQualityScore,
  ToolUsageStats,
  SubagentStats,
  ConversationTurn,
} from "./types.js";

interface AnalyzeInput {
  conversations: ConversationTurn[];
  messageCount: number;
  ticketId?: string;
}

const KNOWN_TOOLS = [
  "Bash", "Read", "Edit", "Write", "Grep", "Glob",
  "WebFetch", "WebSearch", "Task", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet",
  "NotebookEdit", "EnterPlanMode", "ExitPlanMode", "AskUserQuestion", "Skill",
];

const CORRECTION_PATTERNS = [
  /\bno,?\s+that'?s?\s+(wrong|not)/i,
  /\btry\s+again\b/i,
  /\bthat\s+didn'?t\s+work\b/i,
  /\brevert\b/i,
  /\bnot\s+what\s+I\s+(asked|wanted|meant)\b/i,
  /\bundo\s+(that|this)\b/i,
  /\bwrong\s+(file|approach|way)\b/i,
  /\bstart\s+over\b/i,
  /\bgo\s+back\b/i,
  /\bactually,?\s+(don'?t|no|never\s*mind)\b/i,
];

const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bfailure\b/i,
  /\bENOENT\b/,
  /\bENOTDIR\b/,
  /\bexit\s+code\s+[1-9]/i,
  /\bTypeError\b/,
  /\bSyntaxError\b/,
  /\bReferenceError\b/,
  /\bcompilation\s+error/i,
  /\bbuild\s+failed/i,
  /\btest\s+failed/i,
  /\bcommand\s+failed/i,
];

const RESOLUTION_PATTERNS = [
  /\bfixed\b/i,
  /\bworking\s+now\b/i,
  /\bsuccessfully\b/i,
  /\bresolved\b/i,
  /\btests?\s+pass/i,
  /\bbuild\s+succeeded/i,
  /\bcompiles?\s+clean/i,
  /\ball\s+good\b/i,
];

const SKILL_PATTERNS = [
  /\/commit\b/,
  /\/review-pr\b/,
  /\/track\b/,
  /\/help\b/,
  /Skill\s+tool/i,
];

const SUBAGENT_TYPES = [
  "Explore", "Plan", "Bash", "general-purpose",
  "smart-commit-bundler", "statusline-setup",
];

/**
 * Analyze a session's conversation content to produce intelligence metrics.
 * Pure function — no side effects, no LLM calls, regex/heuristic only.
 */
export function analyzeSession(input: AnalyzeInput): SessionIntelligence {
  return {
    qualityScore: computeQualityScore(input),
    toolUsage: computeToolUsage(input),
    subagentStats: computeSubagentStats(input),
  };
}

function computeQualityScore(input: AnalyzeInput): SessionQualityScore {
  const { conversations } = input;

  const userMessages = conversations.filter((c) => c.role === "user");
  const assistantMessages = conversations.filter((c) => c.role === "assistant");
  const allContent = conversations.map((c) => c.content).join("\n");

  // Plan mode detection
  const planModeUsed =
    /\bEnterPlanMode\b/.test(allContent) ||
    /\bExitPlanMode\b/.test(allContent) ||
    /\bplan\s+mode\b/i.test(allContent) ||
    /\bPlan\s+agent\b/i.test(allContent);

  // Correction rate
  const corrections = userMessages.filter((m) =>
    CORRECTION_PATTERNS.some((p) => p.test(m.content))
  ).length;
  const correctionRate =
    userMessages.length > 0 ? corrections / userMessages.length : 0;

  // One-shot success: ≤2 user messages after the first
  const followUpCount = Math.max(0, userMessages.length - 1);
  const oneShotSuccess = followUpCount <= 2;

  // Error recovery
  const hasErrors = ERROR_PATTERNS.some((p) => p.test(allContent));
  const hasResolution = RESOLUTION_PATTERNS.some((p) => p.test(allContent));
  let errorRecovery: number;
  if (!hasErrors) {
    errorRecovery = 1.0;
  } else if (hasResolution) {
    errorRecovery = 0.7;
  } else {
    errorRecovery = 0.3;
  }

  // Overall score (1-5)
  let overall = 3.0;
  if (planModeUsed) overall += 0.3;
  if (oneShotSuccess) overall += 0.8;
  overall -= correctionRate * 1.5;
  overall += errorRecovery * 0.5 - 0.25;
  overall = Math.round(Math.min(5, Math.max(1, overall)) * 10) / 10;

  return {
    overall,
    planModeUsed,
    correctionRate: Math.round(correctionRate * 100) / 100,
    oneShotSuccess,
    errorRecovery,
    turnsToComplete: userMessages.length + assistantMessages.length,
  };
}

function computeToolUsage(input: AnalyzeInput): ToolUsageStats {
  const { conversations } = input;
  const toolCounts: Record<string, number> = {};
  let totalToolCalls = 0;
  const skillSet = new Set<string>();

  for (const turn of conversations) {
    // Count from structured toolCalls if available
    if (turn.toolCalls) {
      for (const tc of turn.toolCalls) {
        toolCounts[tc.name] = (toolCounts[tc.name] || 0) + 1;
        totalToolCalls++;
      }
    }

    // Also scan assistant content for tool name mentions
    if (turn.role === "assistant") {
      for (const tool of KNOWN_TOOLS) {
        // Match tool names that appear as standalone words (likely tool invocations)
        const regex = new RegExp(`\\b${tool}\\b`, "g");
        const matches = turn.content.match(regex);
        if (matches) {
          // Only count from content when no structured toolCalls
          if (!turn.toolCalls || turn.toolCalls.length === 0) {
            toolCounts[tool] = (toolCounts[tool] || 0) + matches.length;
            totalToolCalls += matches.length;
          }
        }
      }

      // Detect skill invocations
      for (const pattern of SKILL_PATTERNS) {
        const match = turn.content.match(pattern);
        if (match) {
          skillSet.add(match[0]);
        }
      }
    }
  }

  // Build top tools (sorted by count, top 10)
  const topTools = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  return {
    toolCounts,
    skillInvocations: [...skillSet],
    totalToolCalls,
    topTools,
  };
}

function computeSubagentStats(input: AnalyzeInput): SubagentStats {
  const { conversations } = input;
  let totalSpawned = 0;
  const subagentTypes: Record<string, number> = {};

  for (const turn of conversations) {
    if (turn.role !== "assistant") continue;

    // Detect Task tool invocations (subagent spawns)
    // Match "Task tool" mentions and "subagent_type" references
    const taskMatches = turn.content.match(/\bTask\b.*\b(agent|subagent)/gi);
    if (taskMatches) {
      totalSpawned += taskMatches.length;
    }

    // Also count from structured toolCalls
    if (turn.toolCalls) {
      for (const tc of turn.toolCalls) {
        if (tc.name === "Task") {
          totalSpawned++;
          // Try to extract subagent type from input
          const taskInput = tc.input as Record<string, unknown> | undefined;
          if (taskInput?.subagent_type) {
            const type = String(taskInput.subagent_type);
            subagentTypes[type] = (subagentTypes[type] || 0) + 1;
          }
        }
      }
    }

    // Extract subagent types from content
    for (const agentType of SUBAGENT_TYPES) {
      const pattern = new RegExp(`\\b${agentType}\\s+agent\\b`, "gi");
      const matches = turn.content.match(pattern);
      if (matches) {
        subagentTypes[agentType] = (subagentTypes[agentType] || 0) + matches.length;
      }
    }

    // Match subagent_type mentions
    const subagentTypeMatch = turn.content.match(/subagent_type\s*[=:]\s*["']?(\w+)/gi);
    if (subagentTypeMatch) {
      for (const m of subagentTypeMatch) {
        const typeMatch = m.match(/["']?(\w+)["']?\s*$/);
        if (typeMatch) {
          const type = typeMatch[1];
          subagentTypes[type] = (subagentTypes[type] || 0) + 1;
        }
      }
    }
  }

  // Build top types
  const topTypes = Object.entries(subagentTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([type, count]) => ({ type, count }));

  return {
    totalSpawned,
    subagentTypes,
    topTypes,
  };
}
