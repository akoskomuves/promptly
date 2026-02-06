import http from "node:http";
import https from "node:https";
import { listSessions, listAllSessions, getSession, countSessions, updateSessionTags } from "../db.js";
import { sessionsListPage, sessionDetailPage } from "../dashboard.js";

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
      const headers = ["id","ticket_id","started_at","finished_at","status","total_tokens","prompt_tokens","response_tokens","message_count","tool_call_count","client_tool","models","category"];
      const csvRows = [headers.join(",")];
      for (const s of sessions) {
        const models = JSON.parse(s.models || "[]").join(";");
        csvRows.push([
          s.id, s.ticket_id, s.started_at, s.finished_at ?? "",
          s.status, s.total_tokens, s.prompt_tokens, s.response_tokens,
          s.message_count, s.tool_call_count, s.client_tool ?? "", models,
          s.category ?? "",
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

    // HTML pages
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
