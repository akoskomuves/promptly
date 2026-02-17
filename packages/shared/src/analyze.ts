import type {
  SessionIntelligence,
  SessionQualityScore,
  ToolUsageStats,
  SubagentStats,
  ConversationTurn,
  ContextWindowMetrics,
  PromptQualityAnalysis,
  PromptQualityInsight,
  SkillUsageAnalytics,
  InstructionEffectiveness,
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
  /\/init\b/,
  /\/clear\b/,
  /\/compact\b/,
  /\/config\b/,
  /\/doctor\b/,
  /\/login\b/,
  /\/logout\b/,
  /\/memory\b/,
  /\/model\b/,
  /\/pr-comments\b/,
  /\/status\b/,
  /\/vim\b/,
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
    contextMetrics: computeContextMetrics(input.conversations),
    promptQuality: computePromptQuality(input.conversations),
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

// ─── Context Window Metrics ────────────────────────────────────────────────

const ESTIMATED_CONTEXT_WINDOW = 200000; // ~200k tokens

/**
 * Compute context window metrics from conversation turns.
 * Tracks cumulative token growth, detects summarization events (>30% drops),
 * and computes peak/utilization stats.
 */
export function computeContextMetrics(
  conversations: ConversationTurn[]
): ContextWindowMetrics {
  if (conversations.length === 0) {
    return {
      peakTokenCount: 0,
      summarizationEvents: 0,
      tokenGrowthRate: 0,
      turnsBeforeSummarization: null,
      contextUtilization: 0,
    };
  }

  let cumulative = 0;
  let peak = 0;
  let summarizationEvents = 0;
  let prevCumulative = 0;
  const turnsBetweenSummarizations: number[] = [];
  let turnsSinceLastSummarization = 0;

  for (const turn of conversations) {
    const tokens = turn.tokenCount ?? Math.ceil(turn.content.length / 4);
    cumulative += tokens;

    // Detect summarization: cumulative should grow, a drop >30% means compaction
    if (prevCumulative > 0 && cumulative < prevCumulative * 0.7) {
      summarizationEvents++;
      turnsBetweenSummarizations.push(turnsSinceLastSummarization);
      turnsSinceLastSummarization = 0;
    }

    if (cumulative > peak) peak = cumulative;
    prevCumulative = cumulative;
    turnsSinceLastSummarization++;
  }

  const totalTokens = conversations.reduce(
    (sum, t) => sum + (t.tokenCount ?? Math.ceil(t.content.length / 4)),
    0
  );
  const tokenGrowthRate =
    conversations.length > 0
      ? Math.round(totalTokens / conversations.length)
      : 0;

  const turnsBeforeSummarization =
    turnsBetweenSummarizations.length > 0
      ? Math.round(
          turnsBetweenSummarizations.reduce((a, b) => a + b, 0) /
            turnsBetweenSummarizations.length
        )
      : null;

  const contextUtilization =
    Math.round((peak / ESTIMATED_CONTEXT_WINDOW) * 100) / 100;

  return {
    peakTokenCount: peak,
    summarizationEvents,
    tokenGrowthRate,
    turnsBeforeSummarization,
    contextUtilization: Math.min(1, contextUtilization),
  };
}

// ─── Prompt Quality Insights ────────────────────────────────────────────────

/**
 * Detect anti-patterns in prompts: vague instructions, excessive back-and-forth,
 * missing context, scope creep, and overly long prompts.
 */
export function computePromptQuality(
  conversations: ConversationTurn[]
): PromptQualityAnalysis {
  const insights: PromptQualityInsight[] = [];
  const userTurns = conversations.filter((c) => c.role === "user");

  if (userTurns.length === 0) {
    return { insights: [], promptEfficiency: 100, avgPromptLength: 0, backAndForthScore: 0 };
  }

  const avgLength =
    Math.round(userTurns.reduce((sum, t) => sum + t.content.split(/\s+/).length, 0) / userTurns.length);

  // 1. Vague prompt: user message <30 words followed by 3+ clarification turns
  for (let i = 0; i < conversations.length; i++) {
    const turn = conversations[i];
    if (turn.role !== "user") continue;
    const wordCount = turn.content.split(/\s+/).length;
    if (wordCount < 30) {
      // Count consecutive back-and-forth after this
      let clarifications = 0;
      for (let j = i + 1; j < conversations.length && j < i + 7; j++) {
        if (conversations[j].role === "user") clarifications++;
      }
      if (clarifications >= 3) {
        insights.push({
          type: "vague-prompt",
          severity: "warning",
          description: `Short prompt (${wordCount} words) followed by ${clarifications} follow-up messages`,
          turnIndex: i,
          suggestion: "Include more context upfront — file paths, expected behavior, and constraints reduce back-and-forth.",
        });
        break; // Only report the first vague prompt
      }
    }
  }

  // 2. Excessive back-and-forth: 3+ consecutive user→assistant pairs without resolution
  let consecutivePairs = 0;
  for (let i = 1; i < conversations.length; i++) {
    if (conversations[i].role === "user" && conversations[i - 1].role === "assistant") {
      const hasResolution = RESOLUTION_PATTERNS.some((p) =>
        p.test(conversations[i - 1].content)
      );
      if (!hasResolution) {
        consecutivePairs++;
      } else {
        consecutivePairs = 0;
      }
    }
    if (consecutivePairs >= 3) {
      insights.push({
        type: "excessive-back-and-forth",
        severity: "warning",
        description: `${consecutivePairs} rounds of conversation without clear resolution`,
        turnIndex: i,
        suggestion: "Consider providing complete requirements in a single message to reduce iterations.",
      });
      break;
    }
  }

  // 3. Missing context: first user message lacks file paths, function names, or error strings
  if (userTurns.length > 0) {
    const first = userTurns[0].content;
    const hasFilePath = /[\/\\][\w.-]+\.\w+/.test(first) || /`[^`]+`/.test(first);
    const hasFunctionName = /\b\w+\(/.test(first);
    const hasErrorString = /\b(error|Error|exception|stack\s*trace)\b/i.test(first);
    const hasCodeBlock = /```/.test(first);

    if (!hasFilePath && !hasFunctionName && !hasErrorString && !hasCodeBlock && first.split(/\s+/).length > 10) {
      insights.push({
        type: "missing-context",
        severity: "info",
        description: "First prompt lacks specific code references (file paths, function names, error strings)",
        turnIndex: 0,
        suggestion: "Including file paths, function names, or error messages helps the AI locate relevant code faster.",
      });
    }
  }

  // 4. Scope creep: new topic words introduced after turn 6
  if (userTurns.length > 3) {
    const earlyWords = new Set(
      userTurns
        .slice(0, 3)
        .flatMap((t) => t.content.toLowerCase().split(/\s+/).filter((w) => w.length > 4))
    );
    const lateWords = userTurns
      .slice(3)
      .flatMap((t) => t.content.toLowerCase().split(/\s+/).filter((w) => w.length > 4));
    const newWords = lateWords.filter((w) => !earlyWords.has(w));
    const newWordRatio = lateWords.length > 0 ? newWords.length / lateWords.length : 0;

    if (newWordRatio > 0.6 && newWords.length > 10) {
      insights.push({
        type: "scope-creep",
        severity: "info",
        description: "Later prompts introduce significantly different topics from the initial request",
        suggestion: "Consider starting a new session when the task scope changes significantly.",
      });
    }
  }

  // 5. Long prompt: user message >500 words
  for (let i = 0; i < conversations.length; i++) {
    if (conversations[i].role !== "user") continue;
    const wordCount = conversations[i].content.split(/\s+/).length;
    if (wordCount > 500) {
      insights.push({
        type: "long-prompt",
        severity: "info",
        description: `Prompt with ${wordCount} words — may include unnecessary context`,
        turnIndex: i,
        suggestion: "Long prompts aren't always bad, but ensure key requirements are clearly stated at the start.",
      });
      break;
    }
  }

  // Prompt efficiency: estimate wasted tokens from back-and-forth
  const totalTokens = conversations.reduce(
    (sum, t) => sum + (t.tokenCount ?? Math.ceil(t.content.length / 4)),
    0
  );
  const correctionTurns = userTurns.filter((m) =>
    CORRECTION_PATTERNS.some((p) => p.test(m.content))
  );
  const estimatedWastedTokens = correctionTurns.reduce(
    (sum, t) => sum + (t.tokenCount ?? Math.ceil(t.content.length / 4)) * 3,
    0
  );
  const promptEfficiency =
    totalTokens > 0
      ? Math.max(0, Math.min(100, Math.round(100 - (estimatedWastedTokens / totalTokens) * 100)))
      : 100;

  // Back-and-forth score: ratio of user turns to total content resolution
  const backAndForthScore =
    userTurns.length > 1
      ? Math.round(((userTurns.length - 1) / conversations.length) * 100)
      : 0;

  return { insights, promptEfficiency, avgPromptLength: avgLength, backAndForthScore };
}

// ─── Skill Usage Analytics ──────────────────────────────────────────────────

interface SkillAnalyticsInput {
  intelligence?: {
    qualityScore?: { overall: number };
    toolUsage?: { skillInvocations: string[] };
  } | null;
}

/**
 * Cross-session aggregation of skill invocations with quality correlation.
 */
export function computeSkillUsageAnalytics(
  sessions: SkillAnalyticsInput[]
): SkillUsageAnalytics {
  const skillMap = new Map<
    string,
    { invocations: number; sessionsUsed: number; qualityScores: number[] }
  >();
  const noSkillQualities: number[] = [];

  for (const s of sessions) {
    const skills = s.intelligence?.toolUsage?.skillInvocations ?? [];
    const quality = s.intelligence?.qualityScore?.overall ?? null;

    if (skills.length === 0) {
      if (quality != null) noSkillQualities.push(quality);
      continue;
    }

    const uniqueSkills = new Set(skills);
    for (const skill of uniqueSkills) {
      const existing = skillMap.get(skill);
      if (existing) {
        existing.invocations += skills.filter((sk) => sk === skill).length;
        existing.sessionsUsed++;
        if (quality != null) existing.qualityScores.push(quality);
      } else {
        skillMap.set(skill, {
          invocations: skills.filter((sk) => sk === skill).length,
          sessionsUsed: 1,
          qualityScores: quality != null ? [quality] : [],
        });
      }
    }
  }

  const avgNoSkill =
    noSkillQualities.length > 0
      ? Math.round(
          (noSkillQualities.reduce((a, b) => a + b, 0) / noSkillQualities.length) * 10
        ) / 10
      : null;

  const skillsList = Array.from(skillMap.entries())
    .map(([name, data]) => ({
      name,
      totalInvocations: data.invocations,
      sessionsUsed: data.sessionsUsed,
      avgQualityWhenUsed:
        data.qualityScores.length > 0
          ? Math.round(
              (data.qualityScores.reduce((a, b) => a + b, 0) / data.qualityScores.length) * 10
            ) / 10
          : null,
      avgQualityWhenNotUsed: avgNoSkill,
    }))
    .sort((a, b) => b.totalInvocations - a.totalInvocations);

  return { skills: skillsList };
}

// ─── Instruction Effectiveness ────────────────────────────────────────────

interface InstructionSessionInput {
  id: string;
  ticketId: string;
  startedAt: string;
  gitActivity?: {
    instructionFileChanges?: string[];
  } | null;
  intelligence?: {
    qualityScore?: { overall: number };
  } | null;
}

/**
 * Find sessions with instruction file changes, compare avg quality
 * of sessions before vs after the change.
 */
export function computeInstructionEffectiveness(
  sessions: InstructionSessionInput[]
): InstructionEffectiveness {
  // Sort by date
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );

  // Find sessions with instruction file changes
  const changes: InstructionEffectiveness["changes"] = [];
  for (const s of sorted) {
    const files = s.gitActivity?.instructionFileChanges;
    if (files && files.length > 0) {
      changes.push({
        sessionId: s.id,
        ticketId: s.ticketId,
        date: s.startedAt,
        files,
      });
    }
  }

  if (changes.length === 0) {
    return { changes: [], beforeAvgQuality: null, afterAvgQuality: null, verdict: "No instruction file changes detected." };
  }

  // Use the earliest change as the pivot point
  const pivotDate = new Date(changes[0].date).getTime();

  // Get quality scores before and after
  const beforeQualities: number[] = [];
  const afterQualities: number[] = [];

  for (const s of sorted) {
    const quality = s.intelligence?.qualityScore?.overall;
    if (quality == null) continue;

    const t = new Date(s.startedAt).getTime();
    if (t < pivotDate) {
      beforeQualities.push(quality);
    } else {
      afterQualities.push(quality);
    }
  }

  // Take last 5 before and first 5 after for comparison
  const beforeSlice = beforeQualities.slice(-5);
  const afterSlice = afterQualities.slice(0, 5);

  const beforeAvg =
    beforeSlice.length > 0
      ? Math.round((beforeSlice.reduce((a, b) => a + b, 0) / beforeSlice.length) * 10) / 10
      : null;
  const afterAvg =
    afterSlice.length > 0
      ? Math.round((afterSlice.reduce((a, b) => a + b, 0) / afterSlice.length) * 10) / 10
      : null;

  let verdict: string;
  if (beforeAvg == null || afterAvg == null) {
    verdict = "Not enough data to compare quality before and after instruction changes.";
  } else if (afterAvg > beforeAvg + 0.2) {
    verdict = `Quality improved from ${beforeAvg} to ${afterAvg} after instruction file updates.`;
  } else if (afterAvg < beforeAvg - 0.2) {
    verdict = `Quality declined from ${beforeAvg} to ${afterAvg} after instruction file updates.`;
  } else {
    verdict = `Quality remained stable (${beforeAvg} -> ${afterAvg}) after instruction file updates.`;
  }

  return { changes, beforeAvgQuality: beforeAvg, afterAvgQuality: afterAvg, verdict };
}
