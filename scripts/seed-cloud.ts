#!/usr/bin/env npx tsx
/**
 * Seed the cloud database with demo sessions.
 * Run: npx tsx scripts/seed-cloud.ts
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_PATH = path.join(os.homedir(), ".promptly", "config.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

if (!config.token) {
  console.error("Not logged in. Run 'promptly login' first.");
  process.exit(1);
}

const API_URL = config.apiUrl || "https://api.getpromptly.xyz";
const TOKEN = config.token;

const ticketPrefixes = ["AUTH", "UI", "API", "FIX", "FEAT", "PERF"];
const ticketNames: Record<string, string[]> = {
  AUTH: ["login-flow", "oauth-google", "session-expiry", "2fa-setup"],
  UI: ["dark-mode", "responsive-nav", "form-validation", "modal-redesign"],
  API: ["rate-limiting", "pagination", "error-handling", "caching-layer"],
  FIX: ["memory-leak", "race-condition", "null-check", "timezone-bug"],
  FEAT: ["export-csv", "notifications", "user-preferences", "audit-log"],
  PERF: ["query-optimization", "lazy-loading", "bundle-size", "image-compression"],
};

const models = [
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-20250514",
  "gpt-4o",
  "gemini-2.5-pro",
];

const sampleConversations = [
  { role: "user", content: "Can you help me implement this feature?" },
  { role: "assistant", content: "I'll start by examining the existing implementation to understand the current architecture." },
  { role: "user", content: "There's a bug in the authentication flow." },
  { role: "assistant", content: "I found the issue. The session token is not being refreshed when it expires. Let me fix that." },
  { role: "user", content: "Can you optimize this database query?" },
  { role: "assistant", content: "The query was doing a full table scan. I added an index and rewrote the JOIN clause." },
];

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function createSession(ticketId: string, daysAgo: number) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysAgo);
  startDate.setHours(rand(9, 18), rand(0, 59), rand(0, 59));

  // Create session
  const createRes = await fetch(`${API_URL}/api/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ ticketId }),
  });

  if (!createRes.ok) {
    console.error(`Failed to create session: ${await createRes.text()}`);
    return null;
  }

  const session = (await createRes.json()) as { id: string };

  // Upload data
  const durationMin = rand(5, 60);
  const finishDate = new Date(startDate.getTime() + durationMin * 60000);
  const messageCount = rand(4, 20);
  const promptTokens = rand(1000, 15000);
  const responseTokens = rand(2000, 25000);

  const conversations = [];
  for (let i = 0; i < Math.min(messageCount, 6); i++) {
    conversations.push({
      ...sampleConversations[i % sampleConversations.length],
      timestamp: new Date(startDate.getTime() + (i / messageCount) * durationMin * 60000).toISOString(),
      model: pick(models),
      tokenCount: rand(100, 2000),
    });
  }

  const uploadRes = await fetch(`${API_URL}/api/sessions/${session.id}/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      conversations,
      models: [pick(models)],
      totalTokens: promptTokens + responseTokens,
      promptTokens,
      responseTokens,
      messageCount,
      toolCallCount: rand(0, messageCount),
      startedAt: startDate.toISOString(),
      finishedAt: finishDate.toISOString(),
    }),
  });

  if (!uploadRes.ok) {
    console.error(`Failed to upload session: ${await uploadRes.text()}`);
    return null;
  }

  return session.id;
}

async function main() {
  console.log(`Seeding sessions to ${API_URL}...`);

  let count = 0;

  // Create 20 sessions spread over the last 14 days
  for (let daysAgo = 14; daysAgo >= 0; daysAgo--) {
    const sessionsToday = rand(1, 3);

    for (let i = 0; i < sessionsToday; i++) {
      const prefix = pick(ticketPrefixes);
      const name = pick(ticketNames[prefix]);
      const ticketId = `${prefix}-${rand(100, 999)}-${name}`;

      const id = await createSession(ticketId, daysAgo);
      if (id) {
        console.log(`  Created: ${ticketId}`);
        count++;
      }
    }
  }

  console.log(`\nSeeded ${count} sessions.`);
  console.log(`View at: https://app.getpromptly.xyz`);
}

main().catch(console.error);
