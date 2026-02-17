/**
 * Static site generator for the Promptly demo.
 *
 * Usage: cd demo && npx tsx generate.ts
 * Prerequisites: pnpm build (from repo root)
 *
 * Generates:
 *   demo/dist/index.html            — sessions list
 *   demo/dist/sessions/<id>.html    — per-session detail
 *   demo/dist/sessions/<id>/replay.html — per-session replay
 *   demo/dist/digest/index.html     — weekly digest
 *   demo/dist/analytics/index.html  — analytics page
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");

// Import from built packages
import {
  sessionsListPage,
  sessionDetailPage,
  sessionReplayPage,
  digestPage,
  analyticsPage,
} from "../packages/cli/dist/dashboard.js";

import { computeWeeklyDigest } from "../packages/shared/dist/digest.js";
import { computeProjectCostTrends } from "../packages/shared/dist/trends.js";
import { detectParallelSessions } from "../packages/shared/dist/parallel.js";
import { computeSkillUsageAnalytics, computeInstructionEffectiveness } from "../packages/shared/dist/analyze.js";
import type { DigestSessionInput } from "../packages/shared/dist/types.js";

import { generateDemoSessions } from "./seed.js";
import { postProcess } from "./post-process.js";

// ─── Generate ─────────────────────────────────────────────────────────────

console.log("Generating demo site...");

const sessions = generateDemoSessions();
console.log(`  Generated ${sessions.length} sessions`);

// Clean and recreate dist
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true });
}
fs.mkdirSync(DIST, { recursive: true });
fs.mkdirSync(path.join(DIST, "sessions"), { recursive: true });
fs.mkdirSync(path.join(DIST, "digest"), { recursive: true });
fs.mkdirSync(path.join(DIST, "analytics"), { recursive: true });

// 1. Sessions list page
const listHtml = sessionsListPage(JSON.stringify(sessions), sessions.length);
fs.writeFileSync(
  path.join(DIST, "index.html"),
  postProcess(listHtml),
  "utf-8"
);
console.log("  Written: dist/index.html");

// 2. Session detail pages + replay pages
for (const session of sessions) {
  const detailHtml = sessionDetailPage(JSON.stringify(session));
  fs.writeFileSync(
    path.join(DIST, "sessions", `${session.id}.html`),
    postProcess(detailHtml),
    "utf-8"
  );

  // Replay page (in a subdirectory)
  const replayDir = path.join(DIST, "sessions", session.id);
  fs.mkdirSync(replayDir, { recursive: true });
  const replayHtml = sessionReplayPage(JSON.stringify(session));
  fs.writeFileSync(
    path.join(replayDir, "replay.html"),
    postProcess(replayHtml),
    "utf-8"
  );
}
console.log(`  Written: dist/sessions/ (${sessions.length} detail + ${sessions.length} replay files)`);

// 3. Digest page — convert sessions to DigestSessionInput format
const digestInputs: DigestSessionInput[] = sessions.map((s) => {
  let gitActivity = null;
  try {
    if (s.git_activity) {
      const ga = JSON.parse(s.git_activity);
      gitActivity = {
        totalCommits: ga.totalCommits,
        totalInsertions: ga.totalInsertions,
        totalDeletions: ga.totalDeletions,
      };
    }
  } catch {}

  let intelligence = null;
  try {
    if (s.intelligence) {
      const intel = JSON.parse(s.intelligence);
      intelligence = {
        qualityScore: intel.qualityScore
          ? { overall: intel.qualityScore.overall }
          : undefined,
      };
    }
  } catch {}

  return {
    ticketId: s.ticket_id,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    status: s.status,
    totalTokens: s.total_tokens,
    promptTokens: s.prompt_tokens,
    responseTokens: s.response_tokens,
    messageCount: s.message_count,
    models: JSON.parse(s.models),
    category: s.category,
    gitActivity,
    intelligence,
  };
});

const digest = computeWeeklyDigest(digestInputs);
const digestHtml = digestPage(JSON.stringify(digest));
fs.writeFileSync(
  path.join(DIST, "digest", "index.html"),
  postProcess(digestHtml),
  "utf-8"
);
console.log("  Written: dist/digest/index.html");

// 4. Analytics page
const projectTrends = computeProjectCostTrends(
  digestInputs.map((s) => ({
    ticketId: s.ticketId,
    startedAt: s.startedAt,
    totalTokens: s.totalTokens,
    promptTokens: s.promptTokens,
    responseTokens: s.responseTokens,
  }))
);

const parallelSessions = detectParallelSessions(
  sessions.map((s) => ({
    id: s.id,
    ticketId: s.ticket_id,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    totalTokens: s.total_tokens,
  }))
);

const skillInputs = sessions.map((s) => {
  let intelligence = null;
  if (s.intelligence) {
    try { intelligence = JSON.parse(s.intelligence); } catch {}
  }
  return { intelligence };
});
const skillUsage = computeSkillUsageAnalytics(skillInputs);

const instrInputs = sessions.map((s) => {
  let gitActivity = null;
  if (s.git_activity) {
    try { gitActivity = JSON.parse(s.git_activity); } catch {}
  }
  let intelligence = null;
  if (s.intelligence) {
    try { intelligence = JSON.parse(s.intelligence); } catch {}
  }
  return {
    id: s.id,
    ticketId: s.ticket_id,
    startedAt: s.started_at,
    gitActivity,
    intelligence,
  };
});
const instructionEffectiveness = computeInstructionEffectiveness(instrInputs);

// Aggregate prompt quality
let totalEfficiency = 0;
let totalPromptLength = 0;
let sessionsWithIntelligence = 0;
let sessionsWithInsights = 0;
for (const s of sessions) {
  if (!s.intelligence) continue;
  try {
    const intel = JSON.parse(s.intelligence);
    if (intel.promptQuality) {
      totalEfficiency += intel.promptQuality.promptEfficiency;
      totalPromptLength += intel.promptQuality.avgPromptLength;
      sessionsWithIntelligence++;
      if (intel.promptQuality.insights?.length > 0) sessionsWithInsights++;
    }
  } catch {}
}

const analyticsData = {
  projectTrends,
  parallelSessions,
  skillUsage,
  instructionEffectiveness,
  avgPromptEfficiency: sessionsWithIntelligence > 0 ? Math.round(totalEfficiency / sessionsWithIntelligence) : null,
  avgPromptLength: sessionsWithIntelligence > 0 ? Math.round(totalPromptLength / sessionsWithIntelligence) : null,
  sessionsWithInsights,
};

const analyticsHtml = analyticsPage(JSON.stringify(analyticsData));
fs.writeFileSync(
  path.join(DIST, "analytics", "index.html"),
  postProcess(analyticsHtml),
  "utf-8"
);
console.log("  Written: dist/analytics/index.html");

// Summary
const totalFiles = 1 + sessions.length * 2 + 1 + 1;
console.log(`\nDone! ${totalFiles} HTML files written to demo/dist/`);
console.log("Open demo/dist/index.html in a browser to preview.");
