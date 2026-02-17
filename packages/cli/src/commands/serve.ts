import http from "node:http";
import https from "node:https";
import { listSessions, listAllSessions, getSession, countSessions, updateSessionTags } from "../db.js";
import { sessionsListPage, sessionDetailPage, digestPage, analyticsPage, sessionReplayPage } from "../dashboard.js";
import {
  computeWeeklyDigest,
  computeProjectCostTrends,
  detectParallelSessions,
  computeSkillUsageAnalytics,
  computeInstructionEffectiveness,
} from "@getpromptly/shared";
import type { DigestSessionInput } from "@getpromptly/shared";

let pricingCache: { data: Record<string, { input_price_per_million: number; output_price_per_million: number }> | null; fetchedAt: number } = { data: null, fetchedAt: 0 };

function fetchPricing(): Promise<Record<string, { input_price_per_million: number; output_price_per_million: number }> | null> {
  const now = Date.now();
  // Cache for 1 hour
  if (pricingCache.data && now - pricingCache.fetchedAt < 3600000) {
    return Promise.resolve(pricingCache.data);
  }
  return new Promise((resolve) => {
    const req = https.get("https://vizra.ai/api/v1/pricing/ai-models", { timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          const models = json?.data?.models || json?.models || json;
          pricingCache = { data: models, fetchedAt: now };
          resolve(models);
        } catch {
          resolve(pricingCache.data);
        }
      });
    });
    req.on("error", () => resolve(pricingCache.data));
    req.on("timeout", () => { req.destroy(); resolve(pricingCache.data); });
  });
}

/** Parse session rows into DigestSessionInput format */
function toDigestInputs(sessions: ReturnType<typeof listAllSessions>): DigestSessionInput[] {
  return sessions.map((s) => {
    let models: string[] = [];
    try { models = JSON.parse(s.models || "[]"); } catch {}
    let gitActivity: DigestSessionInput["gitActivity"] = null;
    if (s.git_activity) {
      try {
        const ga = JSON.parse(s.git_activity);
        gitActivity = { totalCommits: ga.totalCommits ?? 0, totalInsertions: ga.totalInsertions ?? 0, totalDeletions: ga.totalDeletions ?? 0 };
      } catch {}
    }
    let intelligence: DigestSessionInput["intelligence"] = null;
    if (s.intelligence) {
      try {
        const intel = JSON.parse(s.intelligence);
        if (intel.qualityScore?.overall != null) {
          intelligence = { qualityScore: { overall: intel.qualityScore.overall } };
        }
      } catch {}
    }
    return {
      ticketId: s.ticket_id,
      startedAt: s.started_at,
      finishedAt: s.finished_at,
      status: s.status,
      totalTokens: s.total_tokens,
      promptTokens: s.prompt_tokens,
      responseTokens: s.response_tokens,
      messageCount: s.message_count,
      models,
      category: s.category,
      gitActivity,
      intelligence,
    };
  });
}

export async function serveCommand(options: { port?: string }) {
  const port = parseInt(options.port ?? "3000", 10);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // Pricing endpoint
    if (url.pathname === "/api/pricing" && req.method === "GET") {
      fetchPricing().then((models) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(models || {}));
      });
      return;
    }

    // Export endpoints
    if (url.pathname === "/api/sessions/export.json" && req.method === "GET") {
      const sessions = listAllSessions();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=\"promptly-sessions.json\"",
      });
      res.end(JSON.stringify(sessions, null, 2));
      return;
    }

    if (url.pathname === "/api/sessions/export.csv" && req.method === "GET") {
      const sessions = listAllSessions();
      const headers = ["id","ticket_id","started_at","finished_at","status","total_tokens","prompt_tokens","response_tokens","message_count","tool_call_count","client_tool","models","category","quality_score","plan_mode","one_shot","correction_rate","top_tools","total_tool_calls","subagent_count"];
      const csvRows = [headers.join(",")];
      for (const s of sessions) {
        const models = JSON.parse(s.models || "[]").join(";");
        let qualityScore = "", planMode = "", oneShot = "", correctionRate = "", topToolsStr = "", totalToolCallsStr = "", subagentCount = "";
        if (s.intelligence) {
          try {
            const intel = JSON.parse(s.intelligence);
            qualityScore = String(intel.qualityScore?.overall ?? "");
            planMode = String(intel.qualityScore?.planModeUsed ?? "");
            oneShot = String(intel.qualityScore?.oneShotSuccess ?? "");
            correctionRate = String(intel.qualityScore?.correctionRate ?? "");
            topToolsStr = (intel.toolUsage?.topTools ?? []).map((t: { name: string; count: number }) => `${t.name}:${t.count}`).join(";");
            totalToolCallsStr = String(intel.toolUsage?.totalToolCalls ?? "");
            subagentCount = String(intel.subagentStats?.totalSpawned ?? "");
          } catch {
            // ignore
          }
        }
        csvRows.push([
          s.id, s.ticket_id, s.started_at, s.finished_at ?? "",
          s.status, s.total_tokens, s.prompt_tokens, s.response_tokens,
          s.message_count, s.tool_call_count, s.client_tool ?? "", models,
          s.category ?? "", qualityScore, planMode, oneShot, correctionRate,
          topToolsStr, totalToolCallsStr, subagentCount,
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
      }
      res.writeHead(200, {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=\"promptly-sessions.csv\"",
      });
      res.end(csvRows.join("\n"));
      return;
    }

    // API endpoints
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
      const sessions = listSessions(limit, offset);
      const total = countSessions();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions, total }));
      return;
    }

    const tagsMatch = url.pathname.match(/^\/api\/sessions\/(.+)\/tags$/);
    if (tagsMatch && req.method === "PUT") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const { tags } = JSON.parse(body);
          if (!Array.isArray(tags) || !tags.every((t: unknown) => typeof t === "string")) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "tags must be an array of strings" }));
            return;
          }
          const ok = updateSessionTags(tagsMatch[1], tags);
          if (!ok) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Session not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ tags }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/(.+)$/);
    if (sessionMatch && req.method === "GET") {
      const session = getSession(sessionMatch[1]);
      if (!session) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(session));
      return;
    }

    // Analytics page
    if (url.pathname === "/analytics") {
      const sessions = listAllSessions();
      const inputs = toDigestInputs(sessions);

      // Project cost trends
      const projectTrends = computeProjectCostTrends(
        inputs.map((s) => ({
          ticketId: s.ticketId,
          startedAt: s.startedAt,
          totalTokens: s.totalTokens,
          promptTokens: s.promptTokens,
          responseTokens: s.responseTokens,
          costEstimate: s.costEstimate,
        }))
      );

      // Parallel sessions
      const parallelSessions = detectParallelSessions(
        sessions.map((s) => ({
          id: s.id,
          ticketId: s.ticket_id,
          startedAt: s.started_at,
          finishedAt: s.finished_at,
          totalTokens: s.total_tokens,
        }))
      );

      // Skill usage analytics
      const skillInputs = sessions.map((s) => {
        let intelligence = null;
        if (s.intelligence) {
          try { intelligence = JSON.parse(s.intelligence); } catch {}
        }
        return { intelligence };
      });
      const skillUsage = computeSkillUsageAnalytics(skillInputs);

      // Instruction effectiveness
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

      // Aggregate prompt quality stats
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

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(analyticsPage(JSON.stringify(analyticsData)));
      return;
    }

    // Digest page
    if (url.pathname === "/digest") {
      const sessions = listAllSessions();
      const inputs = toDigestInputs(sessions);
      const digest = computeWeeklyDigest(inputs);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(digestPage(JSON.stringify(digest)));
      return;
    }

    // Session replay page
    const replayMatch = url.pathname.match(/^\/sessions\/(.+)\/replay$/);
    if (replayMatch) {
      const session = getSession(replayMatch[1]);
      if (!session) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Session not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(sessionReplayPage(JSON.stringify(session)));
      return;
    }

    // HTML pages — session detail
    const detailMatch = url.pathname.match(/^\/sessions\/(.+)$/);
    if (detailMatch) {
      const session = getSession(detailMatch[1]);
      if (!session) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Session not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(sessionDetailPage(JSON.stringify(session)));
      return;
    }

    // Default: sessions list
    if (url.pathname === "/" || url.pathname === "/sessions") {
      const sessions = listSessions(50, 0);
      const total = countSessions();
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(sessionsListPage(JSON.stringify(sessions), total));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.listen(port, () => {
    console.log(`Promptly dashboard running at http://localhost:${port}`);
    console.log("Press Ctrl+C to stop.");
  });
}
