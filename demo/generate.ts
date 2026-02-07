/**
 * Static site generator for the Promptly demo.
 *
 * Usage: cd demo && npx tsx generate.ts
 * Prerequisites: pnpm build (from repo root)
 *
 * Generates:
 *   demo/dist/index.html          — sessions list
 *   demo/dist/sessions/<id>.html  — per-session detail
 *   demo/dist/digest/index.html   — weekly digest
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
  digestPage,
} from "../packages/cli/dist/dashboard.js";

import { computeWeeklyDigest } from "../packages/shared/dist/digest.js";
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

// 1. Sessions list page
const listHtml = sessionsListPage(JSON.stringify(sessions), sessions.length);
fs.writeFileSync(
  path.join(DIST, "index.html"),
  postProcess(listHtml),
  "utf-8"
);
console.log("  Written: dist/index.html");

// 2. Session detail pages
for (const session of sessions) {
  const detailHtml = sessionDetailPage(JSON.stringify(session));
  fs.writeFileSync(
    path.join(DIST, "sessions", `${session.id}.html`),
    postProcess(detailHtml),
    "utf-8"
  );
}
console.log(`  Written: dist/sessions/ (${sessions.length} files)`);

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

// Summary
const totalFiles = 1 + sessions.length + 1;
console.log(`\nDone! ${totalFiles} HTML files written to demo/dist/`);
console.log("Open demo/dist/index.html in a browser to preview.");
