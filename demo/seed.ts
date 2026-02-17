/**
 * Seed data generator for the Promptly demo.
 * Produces 25-30 realistic DbSession objects in memory — no SQLite needed.
 * Uses a seeded PRNG so IDs are stable across regenerations.
 */

// ─── Seeded PRNG (mulberry32) ─────────────────────────────────────────────

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rng = mulberry32(42);

function rand(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => rng() - 0.5);
  return shuffled.slice(0, n);
}

function stableId(index: number): string {
  // Deterministic IDs based on index
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "demo";
  let n = index * 7919 + 1337; // spread out
  for (let i = 0; i < 8; i++) {
    id += chars[n % chars.length];
    n = Math.floor(n / chars.length) + index + i * 31;
  }
  return id;
}

// ─── Session data pools ───────────────────────────────────────────────────

interface DbSession {
  id: string;
  ticket_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  total_tokens: number;
  prompt_tokens: number;
  response_tokens: number;
  message_count: number;
  tool_call_count: number;
  conversations: string; // JSON string
  models: string; // JSON string
  tags: string; // JSON string
  client_tool: string | null;
  git_activity: string | null; // JSON string
  category: string | null;
  intelligence: string | null; // JSON string
  created_at: string;
}

const TICKET_SPECS = [
  // project, number, description (for conversations)
  { project: "AUTH", num: 142, desc: "OAuth login flow with Google SSO" },
  { project: "AUTH", num: 215, desc: "JWT token refresh race condition" },
  { project: "AUTH", num: 87, desc: "Password reset email template" },
  { project: "UI", num: 78, desc: "Responsive sidebar navigation" },
  { project: "UI", num: 134, desc: "Dark mode toggle persistence" },
  { project: "UI", num: 201, desc: "Form validation error states" },
  { project: "UI", num: 45, desc: "Loading skeleton components" },
  { project: "API", num: 201, desc: "Rate limiting middleware" },
  { project: "API", num: 156, desc: "Pagination cursor implementation" },
  { project: "API", num: 312, desc: "Webhook retry logic with exponential backoff" },
  { project: "API", num: 89, desc: "Search endpoint with full-text indexing" },
  { project: "DB", num: 55, desc: "Query optimization for user sessions table" },
  { project: "DB", num: 102, desc: "Database migration for new schema" },
  { project: "PERF", num: 33, desc: "Bundle size reduction with tree shaking" },
  { project: "PERF", num: 67, desc: "Image lazy loading and WebP conversion" },
  { project: "PERF", num: 14, desc: "Connection pool tuning for PostgreSQL" },
  { project: "AUTH", num: 301, desc: "Session expiry and refresh token rotation" },
  { project: "UI", num: 290, desc: "Accessibility audit — keyboard navigation" },
  { project: "API", num: 445, desc: "Error response standardization" },
  { project: "DB", num: 78, desc: "Add indexes for frequently joined columns" },
  { project: "UI", num: 310, desc: "Table column sorting and filtering" },
  { project: "AUTH", num: 55, desc: "RBAC permission checks for admin routes" },
  { project: "API", num: 178, desc: "File upload endpoint with presigned URLs" },
  { project: "PERF", num: 91, desc: "React memo optimization for list rendering" },
  { project: "UI", num: 167, desc: "Toast notification system" },
  { project: "DB", num: 134, desc: "Audit log table and triggers" },
  { project: "API", num: 520, desc: "Batch processing endpoint for imports" },
  { project: "AUTH", num: 188, desc: "Two-factor authentication setup flow" },
] as const;

const MODELS_BY_TOOL: Record<string, string[]> = {
  "claude-code": [
    "claude-sonnet-4-5-20250929",
    "claude-opus-4-5-20250414",
  ],
  "codex-cli": ["gpt-4o", "o3-mini"],
  "gemini-cli": ["gemini-2.0-flash", "gemini-2.5-pro"],
};

type Category =
  | "feature"
  | "bug-fix"
  | "refactor"
  | "investigation"
  | "testing"
  | "docs";

const CATEGORIES: { cat: Category; weight: number }[] = [
  { cat: "feature", weight: 35 },
  { cat: "bug-fix", weight: 25 },
  { cat: "refactor", weight: 15 },
  { cat: "investigation", weight: 10 },
  { cat: "testing", weight: 10 },
  { cat: "docs", weight: 5 },
];

function pickCategory(): Category {
  const r = rand(1, 100);
  let cum = 0;
  for (const { cat, weight } of CATEGORIES) {
    cum += weight;
    if (r <= cum) return cat;
  }
  return "feature";
}

function pickTool(): string {
  const r = rand(1, 100);
  if (r <= 60) return "claude-code";
  if (r <= 80) return "codex-cli";
  return "gemini-cli";
}

const TAG_OPTIONS = [
  "frontend",
  "backend",
  "security",
  "performance",
  "urgent",
  "database",
  "testing",
  "documentation",
  "devops",
  "mobile",
];

// ─── Conversation templates ───────────────────────────────────────────────

const USER_MESSAGES: Record<Category, string[]> = {
  feature: [
    "I need to implement {desc}. Where should I start?",
    "Let's add {desc}. Can you scaffold the basic structure?",
    "The PM wants {desc} shipped this sprint. Let's break it down.",
    "Can you implement {desc}? Here's the spec from the ticket.",
    "We need to add {desc} to the existing codebase.",
    "Looks good. Can you add error handling and input validation?",
    "Can you also add tests for the happy path and edge cases?",
    "One more thing — we need a loading state while the API call is in progress.",
    "That's working. Let's also add a success notification.",
    "Can you update the types to include the new fields?",
  ],
  "bug-fix": [
    "Users are reporting {desc} is broken. Can you investigate?",
    "There's a bug with {desc}. It fails intermittently in production.",
    "The QA team found a regression in {desc}. Let's fix it.",
    "I'm seeing errors in the logs related to {desc}.",
    "Can you check why {desc} stopped working after the last deploy?",
    "Hmm, I think the root cause is different. Can you check the middleware?",
    "That fixed the immediate issue, but can you add a regression test?",
    "Can you also check if this affects any other endpoints?",
    "Let's add better error logging so we catch this faster next time.",
    "Please also update the error message to be more user-friendly.",
  ],
  refactor: [
    "This module handling {desc} is getting messy. Let's clean it up.",
    "I want to refactor {desc} to use the new patterns we agreed on.",
    "The {desc} code has too much duplication. Can you extract shared logic?",
    "Let's refactor {desc} to be more testable.",
    "Can you split this into smaller, focused functions?",
    "Good. Now let's update the callers to use the new interface.",
    "Can you make sure all the existing tests still pass?",
    "Let's also add JSDoc comments to the public API.",
  ],
  investigation: [
    "I need to understand how {desc} currently works before we change it.",
    "Can you trace through {desc} and explain the data flow?",
    "What's the performance profile of {desc}? Any bottlenecks?",
    "I want to explore different approaches for {desc}.",
    "Can you research best practices for implementing {desc}?",
    "Interesting. What are the trade-offs between those approaches?",
    "Can you create a quick proof of concept?",
    "Let's document our findings before we start implementing.",
  ],
  testing: [
    "We need better test coverage for {desc}.",
    "Can you write integration tests for {desc}?",
    "The tests for {desc} are flaky. Can you investigate why?",
    "Let's add end-to-end tests for the {desc} flow.",
    "Can you set up test fixtures for {desc}?",
    "Good. Can you also add tests for the error cases?",
    "Let's add a test for the race condition we found earlier.",
    "Can you verify the tests run in both local and CI environments?",
  ],
  docs: [
    "We need to document {desc} for the team.",
    "Can you write API documentation for {desc}?",
    "The README is outdated regarding {desc}. Can you update it?",
    "Let's add inline code comments explaining {desc}.",
    "Can you create a migration guide for {desc}?",
    "Can you also add code examples to the docs?",
    "Let's add a troubleshooting section too.",
  ],
};

const ASSISTANT_MESSAGES: Record<Category, string[]> = {
  feature: [
    "I'll start by examining the existing codebase to understand the current architecture. Let me read the relevant files.",
    "Here's my plan: First I'll create the data model, then the API endpoint, then the UI component. Let me start with the types.",
    "I've scaffolded the basic structure. The new component is at `src/components/{ticket}.tsx` with the API handler at `src/api/{ticket}.ts`.",
    "I've added comprehensive error handling with proper HTTP status codes and user-facing error messages.",
    "Tests are written. 8 test cases covering the happy path, validation errors, auth failures, and edge cases. All passing.",
    "Loading state is implemented using a custom `useAsync` hook. The UI shows a skeleton while the request is in flight.",
    "Done! The success notification uses our existing toast system. I also added a dismiss timeout of 5 seconds.",
    "Types are updated in `src/types.ts`. I've also updated the API client to include the new fields.",
    "Everything is wired up and working. Here's a summary of all the changes I made across 6 files.",
  ],
  "bug-fix": [
    "Let me investigate. I'll start by checking the error logs and tracing the request flow.",
    "I found the issue. The race condition happens when two requests hit the endpoint simultaneously because the lock isn't properly scoped.",
    "The fix is straightforward — I've added a mutex around the critical section and updated the error handling.",
    "I've added a regression test that reproduces the exact scenario. It was failing before the fix and passes now.",
    "I checked all related endpoints. Two others had a similar pattern, so I fixed those preventively.",
    "Error logging is improved. I've added structured logging with request IDs so we can correlate across services.",
    "The error message now explains what happened and suggests the user retry. Much better UX than the generic 500.",
    "All tests pass, including the new regression tests. The fix is contained to 3 files.",
  ],
  refactor: [
    "Let me analyze the current implementation first. I'll map out the dependencies and identify the cleanest refactoring path.",
    "I've extracted the shared logic into a utility module at `src/utils/{ticket}.ts`. The duplication is eliminated.",
    "The refactored code is more testable now — all dependencies are injected rather than imported directly.",
    "I've split the monolithic function into 4 focused helpers. Each has a single responsibility and is independently testable.",
    "All callers are updated. I used the adapter pattern to maintain backwards compatibility during the transition.",
    "All 47 existing tests pass. No behavior changes, just cleaner code structure.",
    "JSDoc comments are added to all public functions. The generated docs look good.",
    "Refactoring is complete. Lines of code went from 380 to 290, and cyclomatic complexity dropped by 40%.",
  ],
  investigation: [
    "Let me trace through the code. The entry point is `src/routes/{ticket}.ts`, which calls into the service layer.",
    "Here's the data flow: Request -> Middleware -> Controller -> Service -> Repository -> Database. The bottleneck is in the service layer.",
    "I ran a quick benchmark. The current implementation takes 450ms on average. 80% of that time is spent in the database query.",
    "I've identified three approaches: 1) Add caching, 2) Optimize the query, 3) Denormalize the data. Let me outline the trade-offs.",
    "Approach 2 is the winner — I can add a composite index that brings the query from 360ms to 12ms with no architectural changes.",
    "Here's the proof of concept. The index is defined in a migration file and the query plan confirms it's being used.",
    "I've documented our findings in a design doc with benchmarks, trade-offs, and the recommended approach.",
  ],
  testing: [
    "Let me audit the current test coverage. I'll run the coverage report and identify the gaps.",
    "Current coverage for this module is 42%. The main gaps are error handling paths and edge cases.",
    "I've written 12 new integration tests covering the full request-response cycle with realistic test data.",
    "The flaky test was caused by a shared database state between test runs. I've isolated each test with a fresh DB transaction.",
    "Test fixtures are set up in `tests/fixtures/{ticket}.ts`. They generate realistic test data using a factory pattern.",
    "Error cases covered: invalid input, auth failure, rate limit exceeded, network timeout, and concurrent access.",
    "The race condition test uses a controlled clock and explicit promise ordering to reproduce deterministically.",
    "All tests pass locally and in CI. Coverage for this module is now 94%.",
  ],
  docs: [
    "Let me review the current docs and identify what's outdated or missing.",
    "I've written comprehensive API documentation covering all endpoints, request/response schemas, and error codes.",
    "The README is updated with the new architecture diagram and getting started instructions.",
    "I've added inline comments to the complex sections. The code should be much easier to follow now.",
    "The migration guide covers all breaking changes with before/after code examples.",
    "Code examples are added for the 3 most common use cases. Each is a complete, runnable snippet.",
    "Troubleshooting section is done. It covers the top 5 issues from our support channel.",
  ],
};

const TOOL_CALLS = [
  { name: "Bash", input: { command: "npm test -- --coverage" } },
  { name: "Read", input: { path: "src/index.ts" } },
  { name: "Edit", input: { path: "src/auth.ts", old_string: "...", new_string: "..." } },
  { name: "Write", input: { path: "src/utils/validate.ts" } },
  { name: "Grep", input: { pattern: "handleAuth", path: "src/" } },
  { name: "Glob", input: { pattern: "**/*.test.ts" } },
  { name: "Bash", input: { command: "git diff --stat" } },
  { name: "Read", input: { path: "package.json" } },
  { name: "Bash", input: { command: "npx prisma migrate dev" } },
  { name: "Read", input: { path: "src/db.ts" } },
  { name: "Edit", input: { path: "src/api/routes.ts", old_string: "...", new_string: "..." } },
  { name: "Bash", input: { command: "curl -s http://localhost:3000/health" } },
  { name: "Read", input: { path: "src/middleware/auth.ts" } },
  { name: "Grep", input: { pattern: "TODO|FIXME", path: "src/" } },
  { name: "Bash", input: { command: "git log --oneline -5" } },
  { name: "Read", input: { path: "tsconfig.json" } },
];

const COMMIT_PREFIXES: Record<Category, string[]> = {
  feature: ["feat", "feat", "feat", "chore"],
  "bug-fix": ["fix", "fix", "fix", "test"],
  refactor: ["refactor", "refactor", "chore"],
  investigation: ["chore", "docs"],
  testing: ["test", "test", "chore"],
  docs: ["docs", "docs", "chore"],
};

const COMMIT_SUBJECTS = [
  "add {component} component",
  "implement {action} endpoint",
  "update error handling for {area}",
  "refactor {component} to use hooks",
  "add validation for {field} input",
  "fix race condition in {area}",
  "add unit tests for {component}",
  "update types for {area}",
  "remove deprecated {component} code",
  "optimize {area} query performance",
  "add loading states to {component}",
  "fix null check in {area} handler",
  "add retry logic for {action}",
  "extract shared {component} utils",
  "update {area} migration",
];

const AREAS = [
  "auth",
  "user-sessions",
  "billing",
  "search",
  "notifications",
  "upload",
  "dashboard",
  "settings",
];
const COMPONENTS = [
  "UserList",
  "SessionCard",
  "AuthForm",
  "NavBar",
  "Modal",
  "DataTable",
  "FilterBar",
  "Toast",
];
const ACTIONS = [
  "create",
  "update",
  "delete",
  "validate",
  "sync",
  "export",
  "import",
];
const FIELDS = [
  "email",
  "password",
  "username",
  "date",
  "amount",
  "status",
  "role",
];

const BRANCH_NAMES: Record<Category, string[]> = {
  feature: [
    "feat/{project}-{num}",
    "feature/{project}-{num}-{slug}",
    "{project}-{num}",
  ],
  "bug-fix": [
    "fix/{project}-{num}",
    "bugfix/{project}-{num}",
    "hotfix/{project}-{num}-{slug}",
  ],
  refactor: [
    "refactor/{project}-{num}",
    "cleanup/{project}-{num}",
    "refactor/{slug}",
  ],
  investigation: ["spike/{project}-{num}", "explore/{slug}"],
  testing: [
    "test/{project}-{num}",
    "tests/{slug}",
    "test/add-coverage-{slug}",
  ],
  docs: ["docs/{project}-{num}", "docs/{slug}", "docs/update-{slug}"],
};

const INSTRUCTION_FILES_POOL = [
  "CLAUDE.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
  "GEMINI.md",
];

const ALL_SKILLS = [
  "/commit",
  "/review-pr",
  "/track",
  "/help",
  "/init",
  "/clear",
  "/compact",
  "/doctor",
  "/memory",
  "/model",
  "/status",
];

// ─── Generator ────────────────────────────────────────────────────────────

function generateCommitMessage(category: Category): string {
  const prefix = pick(COMMIT_PREFIXES[category]);
  let subject = pick(COMMIT_SUBJECTS);
  subject = subject
    .replace("{component}", pick(COMPONENTS))
    .replace("{action}", pick(ACTIONS))
    .replace("{area}", pick(AREAS))
    .replace("{field}", pick(FIELDS));
  return `${prefix}: ${subject}`;
}

function generateBranch(
  category: Category,
  project: string,
  num: number,
  slug: string
): string {
  let branch = pick(BRANCH_NAMES[category]);
  return branch
    .replace("{project}", project.toLowerCase())
    .replace("{num}", String(num))
    .replace("{slug}", slug);
}

function generateConversation(
  category: Category,
  desc: string,
  ticketId: string,
  model: string,
  startTime: Date,
  durationMin: number,
  turnCount: number
): {
  conversations: unknown[];
  totalPromptTokens: number;
  totalResponseTokens: number;
} {
  const userMsgs = USER_MESSAGES[category];
  const assistantMsgs = ASSISTANT_MESSAGES[category];
  const conversations: unknown[] = [];
  let totalPromptTokens = 0;
  let totalResponseTokens = 0;

  for (let t = 0; t < turnCount; t++) {
    const role = t % 2 === 0 ? "user" : "assistant";
    const pool = role === "user" ? userMsgs : assistantMsgs;
    const msgIdx = Math.floor(t / 2) % pool.length;
    let content = pool[msgIdx].replace("{desc}", desc).replace("{ticket}", ticketId);

    const turnTime = new Date(
      startTime.getTime() + (t / turnCount) * durationMin * 60000
    );

    const tokenCount =
      role === "user" ? rand(150, 600) : rand(600, 1800);

    if (role === "user") {
      totalPromptTokens += tokenCount;
    } else {
      totalResponseTokens += tokenCount;
    }

    const turn: Record<string, unknown> = {
      role,
      content,
      timestamp: turnTime.toISOString(),
      model,
      tokenCount,
    };

    // Add tool calls to ~60% of assistant messages
    if (role === "assistant" && rng() > 0.4) {
      const numTools = rand(1, 4);
      turn.toolCalls = Array.from({ length: numTools }, () => pick(TOOL_CALLS));
    }

    conversations.push(turn);
  }

  return { conversations, totalPromptTokens, totalResponseTokens };
}

function generateContextMetrics(turnCount: number): object {
  const peakTokenCount = rand(20000, 180000);
  const summarizationEvents = peakTokenCount > 100000 ? rand(1, 3) : 0;
  const tokenGrowthRate = rand(500, 2500);
  const turnsBeforeSummarization = summarizationEvents > 0 ? rand(8, 25) : null;
  const contextUtilization = Math.round((peakTokenCount / 200000) * 100) / 100;

  return {
    peakTokenCount,
    summarizationEvents,
    tokenGrowthRate,
    turnsBeforeSummarization,
    contextUtilization: Math.min(1, contextUtilization),
  };
}

function generatePromptQuality(turnCount: number): object {
  const insights: object[] = [];
  const types = ["vague-prompt", "excessive-back-and-forth", "missing-context", "scope-creep", "long-prompt"];
  const severities = ["info", "warning", "critical"];

  // ~40% chance of having insights
  if (rng() < 0.4) {
    const numInsights = rand(1, 3);
    const usedTypes = new Set<string>();
    for (let i = 0; i < numInsights; i++) {
      const type = pick(types);
      if (usedTypes.has(type)) continue;
      usedTypes.add(type);
      const severity = type === "excessive-back-and-forth" ? "warning" :
                       type === "vague-prompt" ? pick(["warning", "critical"]) :
                       pick(severities);
      const descriptions: Record<string, string> = {
        "vague-prompt": "Short prompt (" + rand(5, 25) + " words) followed by " + rand(3, 5) + " follow-up messages",
        "excessive-back-and-forth": rand(3, 6) + " rounds of conversation without clear resolution",
        "missing-context": "First prompt lacks specific code references (file paths, function names, error strings)",
        "scope-creep": "Later prompts introduce significantly different topics from the initial request",
        "long-prompt": "Prompt with " + rand(500, 1200) + " words — may include unnecessary context",
      };
      const suggestions: Record<string, string> = {
        "vague-prompt": "Include more context upfront — file paths, expected behavior, and constraints reduce back-and-forth.",
        "excessive-back-and-forth": "Consider providing complete requirements in a single message to reduce iterations.",
        "missing-context": "Including file paths, function names, or error messages helps the AI locate relevant code faster.",
        "scope-creep": "Consider starting a new session when the task scope changes significantly.",
        "long-prompt": "Long prompts aren't always bad, but ensure key requirements are clearly stated at the start.",
      };
      insights.push({
        type,
        severity,
        description: descriptions[type],
        turnIndex: rand(0, turnCount - 1),
        suggestion: suggestions[type],
      });
    }
  }

  const promptEfficiency = rand(55, 100);
  const avgPromptLength = rand(15, 120);
  const backAndForthScore = rand(5, 45);

  return { insights, promptEfficiency, avgPromptLength, backAndForthScore };
}

function generateIntelligence(
  category: Category,
  turnCount: number,
  toolCallCount: number
): object {
  const overall = Math.round((rand(25, 48) / 10) * 10) / 10; // 2.5-4.8
  const planModeUsed = rng() > 0.6;
  const oneShotSuccess = turnCount <= 4 && rng() > 0.3;
  const correctionRate = Math.round(rng() * 30) / 100; // 0.00-0.30
  const errorRecovery = pick([1, 1, 1, 0.7, 0.7, 0.3]);

  // Tool usage breakdown
  const toolNames = ["Bash", "Read", "Edit", "Write", "Grep", "Glob"];
  const toolCounts: Record<string, number> = {};
  let remaining = toolCallCount;
  for (const name of toolNames) {
    if (remaining <= 0) break;
    const count = Math.min(remaining, rand(1, Math.ceil(toolCallCount / 3)));
    toolCounts[name] = count;
    remaining -= count;
  }
  if (remaining > 0) toolCounts["Bash"] = (toolCounts["Bash"] || 0) + remaining;

  const topTools = Object.entries(toolCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Skills — more variety now
  const skills: string[] = [];
  if (rng() > 0.5) skills.push("/commit");
  if (rng() > 0.7) skills.push("/review-pr");
  if (rng() > 0.85) skills.push(pick(["/track", "/init", "/doctor", "/memory", "/model", "/status"]));

  // Subagent stats
  const totalSpawned = rand(0, 5);
  const subagentTypes: Record<string, number> = {};
  const typePool = ["Explore", "Plan", "Bash", "general-purpose"];
  let spawnRemaining = totalSpawned;
  for (const type of typePool) {
    if (spawnRemaining <= 0) break;
    const count = rand(1, spawnRemaining);
    subagentTypes[type] = count;
    spawnRemaining -= count;
  }

  return {
    qualityScore: {
      overall,
      planModeUsed,
      oneShotSuccess,
      correctionRate,
      errorRecovery,
      turnsToComplete: turnCount,
    },
    toolUsage: {
      toolCounts,
      skillInvocations: skills,
      totalToolCalls: toolCallCount,
      topTools,
    },
    subagentStats: {
      totalSpawned,
      subagentTypes,
      topTypes: Object.entries(subagentTypes)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
    },
    contextMetrics: generateContextMetrics(turnCount),
    promptQuality: generatePromptQuality(turnCount),
  };
}

// ─── Main export ──────────────────────────────────────────────────────────

export function generateDemoSessions(referenceDate?: Date): DbSession[] {
  // Reset PRNG for deterministic output
  rng = mulberry32(42);

  const ref = referenceDate ?? new Date();
  const sessions: DbSession[] = [];
  let sessionIdx = 0;

  // Generate sessions across 14 days (2 weeks)
  for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
    const date = new Date(ref);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(0, 0, 0, 0);

    const dayOfWeek = date.getDay();
    const isWeekday = dayOfWeek > 0 && dayOfWeek < 6;

    // 2-3 sessions on weekdays, 0-1 on weekends
    const sessionsToday = isWeekday ? rand(2, 3) : rand(0, 1);

    for (let i = 0; i < sessionsToday; i++) {
      const ticket = TICKET_SPECS[sessionIdx % TICKET_SPECS.length];
      const ticketId = `${ticket.project}-${ticket.num}`;
      const category = pickCategory();
      const tool = pickTool();
      const modelPool = MODELS_BY_TOOL[tool];
      const model = pick(modelPool);
      const sessionModels =
        rng() > 0.75 ? modelPool : [model];

      // Session timing — create overlapping sessions ~15% of the time
      const hour = rand(9, 18);
      const minute = rand(0, 59);
      const startDate = new Date(date);
      startDate.setHours(hour, minute, rand(0, 59));

      // For overlapping sessions, start within 10 minutes of previous session
      if (i > 0 && sessions.length > 0 && rng() < 0.15) {
        const prevSession = sessions[sessions.length - 1];
        if (prevSession.finished_at) {
          const prevStart = new Date(prevSession.started_at).getTime();
          const prevEnd = new Date(prevSession.finished_at).getTime();
          const overlapStart = new Date(prevStart + (prevEnd - prevStart) * 0.3);
          startDate.setTime(overlapStart.getTime());
        }
      }

      const durationMin = rand(5, 75);
      const endDate = new Date(startDate.getTime() + durationMin * 60000);

      // Only the very last session today might be active (and only on day 0)
      const isActive =
        daysAgo === 0 && i === sessionsToday - 1 && rng() > 0.8;

      const turnCount = rand(6, 20);
      const messageCount = turnCount;
      const toolCallCount = rand(
        Math.floor(turnCount * 0.5),
        Math.floor(turnCount * 2)
      );

      const { conversations, totalPromptTokens, totalResponseTokens } =
        generateConversation(
          category,
          ticket.desc,
          ticketId,
          model,
          startDate,
          durationMin,
          turnCount
        );

      // Tags (~60% of sessions)
      const tags = rng() > 0.4 ? pickN(TAG_OPTIONS, rand(1, 3)) : [];

      // Git activity (~60% of sessions)
      let gitActivity: object | null = null;
      if (rng() > 0.4) {
        const numCommits = rand(1, 5);
        const slug = ticket.desc
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 30);
        const branch = generateBranch(
          category,
          ticket.project,
          ticket.num,
          slug
        );
        const commits = Array.from({ length: numCommits }, (_, ci) => {
          const msg = generateCommitMessage(category);
          const ins = rand(5, 150);
          const del = rand(0, 80);
          return {
            hash: stableId(sessionIdx * 100 + ci).slice(0, 7),
            message: msg,
            timestamp: new Date(
              startDate.getTime() +
                ((ci + 1) / (numCommits + 1)) * durationMin * 60000
            ).toISOString(),
            filesChanged: rand(1, 12),
            insertions: ins,
            deletions: del,
          };
        });

        // ~15% of git sessions include instruction file changes
        const instructionFileChanges: string[] = [];
        if (rng() < 0.15) {
          const numFiles = rand(1, 2);
          for (let f = 0; f < numFiles; f++) {
            const file = pick(INSTRUCTION_FILES_POOL);
            if (!instructionFileChanges.includes(file)) {
              instructionFileChanges.push(file);
            }
          }
        }

        gitActivity = {
          branch,
          commits,
          totalCommits: numCommits,
          totalInsertions: commits.reduce((s, c) => s + c.insertions, 0),
          totalDeletions: commits.reduce((s, c) => s + c.deletions, 0),
          totalFilesChanged: commits.reduce((s, c) => s + c.filesChanged, 0),
          ...(instructionFileChanges.length > 0 ? { instructionFileChanges } : {}),
        };
      }

      // Intelligence (all completed sessions)
      const intelligence = isActive
        ? null
        : generateIntelligence(category, turnCount, toolCallCount);

      const session: DbSession = {
        id: stableId(sessionIdx),
        ticket_id: ticketId,
        started_at: startDate.toISOString(),
        finished_at: isActive ? null : endDate.toISOString(),
        status: isActive ? "ACTIVE" : "COMPLETED",
        total_tokens: totalPromptTokens + totalResponseTokens,
        prompt_tokens: totalPromptTokens,
        response_tokens: totalResponseTokens,
        message_count: messageCount,
        tool_call_count: toolCallCount,
        conversations: JSON.stringify(conversations),
        models: JSON.stringify(sessionModels),
        tags: JSON.stringify(tags),
        client_tool: tool,
        git_activity: gitActivity ? JSON.stringify(gitActivity) : null,
        category,
        intelligence: intelligence ? JSON.stringify(intelligence) : null,
        created_at: startDate.toISOString(),
      };

      sessions.push(session);
      sessionIdx++;
    }
  }

  return sessions;
}
