import http from "node:http";
import { listSessions, getSession, countSessions } from "../db.js";
import { sessionsListPage, sessionDetailPage } from "../dashboard.js";

export async function serveCommand(options: { port?: string }) {
  const port = parseInt(options.port ?? "3000", 10);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

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
