#!/usr/bin/env npx tsx
/**
 * Seed the local SQLite database with realistic demo sessions.
 * Run: npx tsx scripts/seed-demo.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const DB_PATH = path.join(os.homedir(), ".promptly", "promptly.db");

// Backup existing DB
if (fs.existsSync(DB_PATH)) {
  const backup = DB_PATH + ".backup-" + Date.now();
  fs.copyFileSync(DB_PATH, backup);
  console.log("Backed up existing DB to", backup);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT DEFAULT 'ACTIVE',
    total_tokens INTEGER DEFAULT 0,
    prompt_tokens INTEGER DEFAULT 0,
    response_tokens INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    tool_call_count INTEGER DEFAULT 0,
    conversations TEXT DEFAULT '[]',
    models TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    client_tool TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
try { db.exec("ALTER TABLE sessions ADD COLUMN client_tool TEXT"); } catch {}

// Clear existing demo data (keep real sessions)
db.exec("DELETE FROM sessions WHERE ticket_id LIKE 'DEMO-%' OR ticket_id LIKE 'AUTH-%' OR ticket_id LIKE 'UI-%' OR ticket_id LIKE 'API-%' OR ticket_id LIKE 'FIX-%' OR ticket_id LIKE 'FEAT-%' OR ticket_id LIKE 'PERF-%' OR ticket_id LIKE 'REFACTOR-%'");

const tools = ["claude-code", "cursor", "gemini-cli", "codex-cli", "windsurf", "copilot"];
const models: Record<string, string[]> = {
  "claude-code": ["claude-opus-4-5-20251101", "claude-sonnet-4-20250514"],
  "cursor": ["claude-sonnet-4-20250514", "gpt-4o"],
  "gemini-cli": ["gemini-2.5-pro", "gemini-2.5-flash"],
  "codex-cli": ["gpt-4o", "o3-mini"],
  "windsurf": ["claude-sonnet-4-20250514", "gpt-4o"],
  "copilot": ["gpt-4o", "gpt-4o-mini"],
};

const ticketPrefixes = ["AUTH", "UI", "API", "FIX", "FEAT", "PERF", "REFACTOR"];
const ticketNames: Record<string, string[]> = {
  "AUTH": ["login-flow", "oauth-google", "session-expiry", "2fa-setup", "password-reset", "jwt-refresh"],
  "UI": ["dark-mode", "responsive-nav", "form-validation", "modal-redesign", "table-sort", "loading-states"],
  "API": ["rate-limiting", "pagination", "error-handling", "caching-layer", "webhook-endpoint", "search-endpoint"],
  "FIX": ["memory-leak", "race-condition", "null-check", "timezone-bug", "cors-headers", "scroll-position"],
  "FEAT": ["export-csv", "notifications", "user-preferences", "audit-log", "batch-upload", "dashboard-filters"],
  "PERF": ["query-optimization", "lazy-loading", "bundle-size", "image-compression", "connection-pool", "index-tuning"],
  "REFACTOR": ["auth-middleware", "state-management", "error-boundaries", "api-client", "test-utils", "db-layer"],
};

const tagOptions = ["bugfix", "feature", "refactor", "urgent", "frontend", "backend", "database", "security", "performance", "testing", "documentation", "devops"];

const roles = ["user", "assistant"];
const sampleUserMessages = [
  "Can you help me implement this feature?",
  "There's a bug in the authentication flow, users are getting logged out randomly.",
  "I need to refactor this component to use the new state management pattern.",
  "Can you optimize this database query? It's taking over 2 seconds.",
  "Let's add error handling for the API endpoints.",
  "The tests are failing on CI, can you investigate?",
  "I want to add pagination to the users list endpoint.",
  "Can you review this code and suggest improvements?",
  "We need to add rate limiting to prevent abuse.",
  "The modal is not closing properly on mobile devices.",
  "Help me set up the webhook integration.",
  "The search is returning incorrect results for special characters.",
];

const sampleAssistantMessages = [
  "I'll start by examining the existing implementation to understand the current architecture.",
  "I found the issue. The session token is not being refreshed when it expires. Let me fix that.",
  "I've refactored the component to use the new pattern. Here are the changes I made.",
  "The query was doing a full table scan. I added an index and rewrote the JOIN clause.",
  "I've added try-catch blocks and proper error responses for all endpoints.",
  "The CI failure is caused by a race condition in the test setup. I've added proper async handling.",
  "I've implemented cursor-based pagination with a default page size of 20.",
  "Here are a few suggestions: extract the validation logic, add input sanitization, and use parameterized queries.",
  "I've implemented a token bucket rate limiter with configurable limits per endpoint.",
  "The issue was with the event listener not being cleaned up. Fixed with a useEffect cleanup.",
  "The webhook endpoint is set up with signature verification and retry logic.",
  "The search query wasn't escaping special regex characters. I've switched to parameterized LIKE queries.",
];

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

const insert = db.prepare(`
  INSERT INTO sessions (id, ticket_id, started_at, finished_at, status, total_tokens, prompt_tokens, response_tokens, message_count, tool_call_count, conversations, models, tags, client_tool)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const now = new Date();
let count = 0;

// Generate 60 sessions spread over the last 30 days
for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
  // 1-4 sessions per day, more on weekdays
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  const isWeekday = date.getDay() > 0 && date.getDay() < 6;
  const sessionsToday = isWeekday ? rand(1, 4) : rand(0, 2);

  for (let i = 0; i < sessionsToday; i++) {
    const tool = pick(tools);
    const modelPool = models[tool];
    const sessionModels = Math.random() > 0.7 ? modelPool : [pick(modelPool)];
    const prefix = pick(ticketPrefixes);
    const name = pick(ticketNames[prefix]);
    const ticketId = `${prefix}-${rand(100, 999)}-${name}`;

    const hour = rand(8, 20);
    const minute = rand(0, 59);
    const startDate = new Date(date);
    startDate.setHours(hour, minute, rand(0, 59));

    const durationMin = rand(2, 90);
    const endDate = new Date(startDate.getTime() + durationMin * 60000);

    const isActive = daysAgo === 0 && i === sessionsToday - 1 && Math.random() > 0.7;

    const messageCount = rand(4, 30);
    const toolCallCount = rand(0, Math.floor(messageCount * 0.8));
    const promptTokens = rand(500, 25000);
    const responseTokens = rand(800, 40000);
    const totalTokens = promptTokens + responseTokens;

    // Generate conversation turns
    const conversations = [];
    const turnCount = Math.min(messageCount, 12); // Cap for data size
    for (let t = 0; t < turnCount; t++) {
      const role = t % 2 === 0 ? "user" : "assistant";
      const content = role === "user" ? pick(sampleUserMessages) : pick(sampleAssistantMessages);
      const turnTime = new Date(startDate.getTime() + (t / turnCount) * durationMin * 60000);
      const turn: Record<string, unknown> = {
        role,
        content,
        timestamp: turnTime.toISOString(),
        model: pick(sessionModels),
        tokenCount: rand(50, 2000),
      };
      if (role === "assistant" && Math.random() > 0.5) {
        turn.toolCalls = Array.from({ length: rand(1, 3) }, () => ({
          name: pick(["read_file", "write_file", "execute_command", "search_code", "list_files"]),
          input: { path: pick(["src/index.ts", "src/auth.ts", "src/db.ts", "package.json", "tests/auth.test.ts"]) },
        }));
      }
      conversations.push(turn);
    }

    const tags = Math.random() > 0.4 ? pickN(tagOptions, rand(1, 3)) : [];

    insert.run(
      generateId(),
      ticketId,
      startDate.toISOString(),
      isActive ? null : endDate.toISOString(),
      isActive ? "ACTIVE" : "COMPLETED",
      totalTokens,
      promptTokens,
      responseTokens,
      messageCount,
      toolCallCount,
      JSON.stringify(conversations),
      JSON.stringify(sessionModels),
      JSON.stringify(tags),
      tool,
    );
    count++;
  }
}

db.close();
console.log(`Seeded ${count} demo sessions over the last 30 days.`);
console.log(`Run: node packages/cli/dist/index.js serve`);
