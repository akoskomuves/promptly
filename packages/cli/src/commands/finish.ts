import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, isLocalMode, getActiveSession, clearActiveSession } from "../config.js";
import { finishSession } from "../db.js";
import { captureGitActivity } from "../git.js";
import { categorizeSession, analyzeSession } from "@getpromptly/shared";
import type { LocalSession } from "@getpromptly/shared";

const BUFFER_FILE = path.join(os.homedir(), ".promptly", "buffer.json");

export async function finishCommand() {
  const session = getActiveSession();
  if (!session) {
    console.error("No active session. Run 'promptly start <ticket-id>' first.");
    process.exit(1);
  }

  const config = loadConfig();

  // Read the MCP buffer
  let buffer: LocalSession | null = null;
  try {
    if (fs.existsSync(BUFFER_FILE)) {
      buffer = JSON.parse(fs.readFileSync(BUFFER_FILE, "utf-8")) as LocalSession;
    }
  } catch {
    // proceed without buffer data
  }

  const finishedAt = new Date().toISOString();
  const gitActivity = captureGitActivity(session.startedAt);

  const category = categorizeSession({
    ticketId: session.ticketId,
    gitActivity,
    conversations: buffer?.conversations ?? null,
  });

  const intelligence = analyzeSession({
    conversations: buffer?.conversations ?? [],
    messageCount: buffer?.messageCount ?? 0,
    ticketId: session.ticketId,
  });

  const uploadData = {
    conversations: buffer?.conversations ?? [],
    models: buffer?.models ?? [],
    clientTool: buffer?.clientTool,
    totalTokens: buffer?.totalTokens ?? 0,
    promptTokens: buffer?.promptTokens ?? 0,
    responseTokens: buffer?.responseTokens ?? 0,
    messageCount: buffer?.messageCount ?? 0,
    toolCallCount: buffer?.toolCallCount ?? 0,
    startedAt: session.startedAt,
    finishedAt,
    gitActivity: gitActivity ?? undefined,
    category,
    intelligence,
  };

  // Always write to local SQLite
  finishSession(session.sessionId, uploadData);

  // In cloud mode, also upload to API
  if (!isLocalMode(config)) {
    try {
      const res = await fetch(
        `${config.apiUrl}/api/sessions/${session.sessionId}/upload`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
          },
          body: JSON.stringify(uploadData),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        console.error(`Failed to upload session: ${res.status} ${text}`);
        console.log("Session saved locally. You can retry upload later.");
      }
    } catch (err) {
      console.error("Could not reach API. Session saved locally.");
      console.error(err instanceof Error ? err.message : err);
    }
  }

  // Calculate duration
  const ms = new Date(finishedAt).getTime() - new Date(session.startedAt).getTime();
  const minutes = Math.floor(ms / 60000);

  console.log(`Session completed for ${session.ticketId}`);
  console.log(`  Category: ${category}`);
  console.log(`  Duration: ${minutes} minutes`);
  console.log(`  Messages: ${buffer?.messageCount ?? 0}`);
  console.log(`  Tokens: ${buffer?.totalTokens ?? 0}`);
  if (gitActivity && gitActivity.totalCommits > 0) {
    console.log(`  Branch: ${gitActivity.branch}`);
    console.log(`  Commits: ${gitActivity.totalCommits} (+${gitActivity.totalInsertions}/-${gitActivity.totalDeletions} lines)`);
  }
  // Intelligence summary
  const qualityStars = "\u2605".repeat(Math.round(intelligence.qualityScore.overall)) +
    "\u2606".repeat(5 - Math.round(intelligence.qualityScore.overall));
  const qualityTraits: string[] = [];
  if (intelligence.qualityScore.planModeUsed) qualityTraits.push("plan mode");
  if (intelligence.qualityScore.oneShotSuccess) qualityTraits.push("one-shot");
  const traitStr = qualityTraits.length > 0 ? ` (${qualityTraits.join(", ")})` : "";
  console.log(`  Quality: ${qualityStars} ${intelligence.qualityScore.overall}/5${traitStr}`);
  if (intelligence.toolUsage.topTools.length > 0) {
    const toolStr = intelligence.toolUsage.topTools.slice(0, 5)
      .map((t) => `${t.name}(${t.count})`)
      .join(", ");
    console.log(`  Tools: ${toolStr}`);
  }
  if (intelligence.subagentStats.totalSpawned > 0) {
    const typeStr = intelligence.subagentStats.topTypes
      .map((t) => `${t.type}: ${t.count}`)
      .join(", ");
    console.log(`  Subagents: ${intelligence.subagentStats.totalSpawned} spawned (${typeStr})`);
  }

  if (isLocalMode(config)) {
    console.log(`\n  Run 'promptly serve' to view the dashboard.`);
  } else {
    console.log(
      `\n  View at: ${config.apiUrl.replace("localhost:3001", "localhost:3000")}/sessions/${session.sessionId}`
    );
  }

  // Clean up
  clearActiveSession();
  try {
    if (fs.existsSync(BUFFER_FILE)) fs.unlinkSync(BUFFER_FILE);
  } catch {
    // ignore
  }
}
