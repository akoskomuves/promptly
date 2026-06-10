import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { input, select } from "@inquirer/prompts";
import { createSession, finishSession, generateId } from "../db.js";
import { categorizeSession, analyzeSession } from "@getpromptly/shared";
import type { ConversationTurn } from "@getpromptly/shared";
import { getAnalytics, getDistinctId } from "../analytics.js";

const CLAUDE_PROJECTS = path.join(os.homedir(), ".claude", "projects");

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

interface ClaudeJsonlLine {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

interface SessionSummary {
  filePath: string;
  sessionId: string;
  cwd: string | null;
  mtime: string;
  sizeKB: number;
}

function unslug(s: string): string {
  // "-Users-akoskomuves-Documents-Promptly" → "/Users/akoskomuves/Documents/Promptly"
  return s.replace(/^-/, "/").replace(/-/g, "/");
}

function listClaudeSessions(limit = 20): SessionSummary[] {
  if (!fs.existsSync(CLAUDE_PROJECTS)) return [];
  const projectDirs = fs
    .readdirSync(CLAUDE_PROJECTS)
    .filter((d) => fs.statSync(path.join(CLAUDE_PROJECTS, d)).isDirectory());

  const summaries: SessionSummary[] = [];
  for (const proj of projectDirs) {
    const projPath = path.join(CLAUDE_PROJECTS, proj);
    let files: string[];
    try {
      files = fs.readdirSync(projPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const filePath = path.join(projPath, f);
      const stat = fs.statSync(filePath);
      summaries.push({
        filePath,
        sessionId: f.replace(/\.jsonl$/, ""),
        cwd: unslug(proj),
        mtime: stat.mtime.toISOString(),
        sizeKB: Math.round(stat.size / 1024),
      });
    }
  }

  summaries.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return summaries.slice(0, limit);
}

interface ParsedSession {
  conversations: ConversationTurn[];
  models: string[];
  startedAt: string | null;
  finishedAt: string | null;
  totalTokens: number;
  promptTokens: number;
  responseTokens: number;
  messageCount: number;
  toolCallCount: number;
  cwd: string | null;
  gitBranch: string | null;
}

function extractContent(content: string | ContentBlock[] | undefined): { text: string; toolCalls: { name: string; input: unknown; timestamp: string }[] } {
  if (typeof content === "string") return { text: content, toolCalls: [] };
  if (!Array.isArray(content)) return { text: "", toolCalls: [] };
  const parts: string[] = [];
  const toolCalls: { name: string; input: unknown; timestamp: string }[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
    } else if (block.type === "tool_use" && block.name) {
      parts.push(`[tool_use: ${block.name}]`);
      toolCalls.push({ name: block.name, input: block.input ?? null, timestamp: "" });
    } else if (block.type === "tool_result") {
      // include nothing — tool results are echoed back via user content already
    }
  }
  return { text: parts.join("\n"), toolCalls };
}

function parseJsonl(filePath: string): ParsedSession {
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  const conversations: ConversationTurn[] = [];
  const modelSet = new Set<string>();
  let startedAt: string | null = null;
  let finishedAt: string | null = null;
  let totalTokens = 0;
  let promptTokens = 0;
  let responseTokens = 0;
  let toolCallCount = 0;
  let cwd: string | null = null;
  let gitBranch: string | null = null;

  for (const line of lines) {
    let obj: ClaudeJsonlLine;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.cwd && !cwd) cwd = obj.cwd;
    if (obj.gitBranch && !gitBranch) gitBranch = obj.gitBranch;

    if (obj.type !== "user" && obj.type !== "assistant") continue;
    if (!obj.message) continue;

    const ts = obj.timestamp ?? new Date().toISOString();
    if (!startedAt) startedAt = ts;
    finishedAt = ts;

    const role = obj.type;
    const { text, toolCalls } = extractContent(obj.message.content);

    if (obj.message.model) modelSet.add(obj.message.model);

    const usage = obj.message.usage;
    const turnTokens = usage
      ? (usage.input_tokens ?? 0) +
        (usage.output_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0)
      : 0;

    if (usage) {
      totalTokens += turnTokens;
      // assistant turns are output-side; user and system turns are input-side
      if (role === "assistant") responseTokens += turnTokens;
      else promptTokens += turnTokens;
    }

    if (toolCalls.length > 0) toolCallCount += toolCalls.length;

    conversations.push({
      role,
      content: text,
      timestamp: ts,
      model: obj.message.model,
      tokenCount: turnTokens || undefined,
      toolCalls: toolCalls.length > 0
        ? toolCalls.map((t) => ({ ...t, timestamp: ts }))
        : undefined,
    });
  }

  return {
    conversations,
    models: Array.from(modelSet),
    startedAt,
    finishedAt,
    totalTokens,
    promptTokens,
    responseTokens,
    messageCount: conversations.length,
    toolCallCount,
    cwd,
    gitBranch,
  };
}

interface ImportOptions {
  session?: string;
  ticket?: string;
  list?: boolean;
}

export async function importClaudeCommand(options: ImportOptions = {}) {
  if (!fs.existsSync(CLAUDE_PROJECTS)) {
    console.error("No Claude Code data found at ~/.claude/projects.");
    process.exit(1);
  }

  const summaries = listClaudeSessions(20);
  if (summaries.length === 0) {
    console.error("No Claude Code sessions found in ~/.claude/projects.");
    process.exit(1);
  }

  if (options.list) {
    console.log("Recent Claude Code sessions:");
    for (const s of summaries) {
      console.log(
        `  ${s.sessionId.substring(0, 8)}  ${path.basename(s.cwd ?? "-")}  ${s.mtime.substring(0, 16)}  ${s.sizeKB}KB`
      );
    }
    return;
  }

  let chosen: SessionSummary | undefined;
  if (options.session) {
    chosen = summaries.find(
      (s) => s.sessionId === options.session || s.sessionId.startsWith(options.session!)
    );
    if (!chosen) {
      console.error(`Session ${options.session} not found in the 20 most recent Claude sessions.`);
      console.error("Run 'promptly import-claude --list' to see available sessions.");
      process.exit(1);
    }
  } else {
    const choice = await select({
      message: "Pick a Claude Code session to import",
      choices: summaries.map((s) => ({
        name: `${s.sessionId.substring(0, 8)}  ${path.basename(s.cwd ?? "-")}  (${s.mtime.substring(0, 16)} · ${s.sizeKB}KB)`,
        value: s.sessionId,
      })),
    });
    chosen = summaries.find((s) => s.sessionId === choice);
  }

  if (!chosen) {
    console.error("No session selected.");
    process.exit(1);
  }

  const ticketId = options.ticket ?? (await input({
    message: "Ticket ID (or leave blank for 'untitled')",
    default: "untitled",
  }));

  const parsed = parseJsonl(chosen.filePath);
  if (parsed.conversations.length === 0) {
    console.error("Session JSONL has no user/assistant messages — nothing to import.");
    process.exit(1);
  }

  const sessionId = generateId();
  createSession(sessionId, ticketId);

  const startedAt = parsed.startedAt ?? new Date().toISOString();
  const finishedAt = parsed.finishedAt ?? new Date().toISOString();

  const category = categorizeSession({
    ticketId,
    gitActivity: null,
    conversations: parsed.conversations,
  });

  const intelligence = analyzeSession({
    conversations: parsed.conversations,
    messageCount: parsed.messageCount,
    ticketId,
  });

  finishSession(sessionId, {
    conversations: parsed.conversations,
    models: parsed.models,
    totalTokens: parsed.totalTokens,
    promptTokens: parsed.promptTokens,
    responseTokens: parsed.responseTokens,
    messageCount: parsed.messageCount,
    toolCallCount: parsed.toolCallCount,
    startedAt,
    finishedAt,
    category,
    intelligence,
    clientTool: "claude-code",
  });

  const minutes = Math.max(
    0,
    Math.floor((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60000)
  );
  getAnalytics().capture({
    distinctId: getDistinctId(),
    event: "session imported",
    properties: {
      message_count: parsed.messageCount,
      total_tokens: parsed.totalTokens,
      category,
      quality_score: intelligence.qualityScore.overall,
      model_count: parsed.models.length,
    },
  });
  await getAnalytics().shutdown();

  console.log(`Imported Claude Code session ${chosen.sessionId.substring(0, 8)} as ${ticketId}`);
  console.log(`  Project: ${parsed.cwd ?? "-"}`);
  console.log(`  Branch: ${parsed.gitBranch ?? "-"}`);
  console.log(`  Messages: ${parsed.messageCount}`);
  console.log(`  Tokens: ${parsed.totalTokens.toLocaleString()}`);
  console.log(`  Models: ${parsed.models.join(", ") || "-"}`);
  console.log(`  Duration: ${minutes}m`);
  console.log(`  Category: ${category}`);
  console.log(`  Quality: ${intelligence.qualityScore.overall}/5`);
  console.log(`  Run 'promptly serve' to view it.`);
}
