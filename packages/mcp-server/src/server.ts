import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getActiveSession,
  writeActiveSession,
  clearActiveSession,
  initBuffer,
  addTurn,
  readBuffer,
  clearBuffer,
  writeToSqlite,
} from "./session.js";
import type { ConversationTurn } from "@getpromptly/shared";

/** The project this MCP server instance is running in (Claude Code spawns one per project). */
function currentProjectDir(): string | undefined {
  const cwd = process.cwd();
  return cwd !== "/" ? cwd : undefined;
}

/** True when the recording was started in a different project than this server's. */
function belongsToOtherProject(recordingDir?: string): boolean {
  const here = currentProjectDir();
  return Boolean(
    recordingDir && here && path.resolve(recordingDir) !== path.resolve(here)
  );
}

function getClientToolName(server: McpServer): string | undefined {
  try {
    const clientInfo = server.server.getClientVersion();
    if (!clientInfo?.name) return undefined;
    return clientInfo.name;
  } catch {
    return undefined;
  }
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "promptly",
    version: "0.1.0",
  });

  // Tool: Start a logging session
  server.tool(
    "promptly_start",
    "Start logging AI conversations for a ticket",
    { ticketId: z.string().optional().describe("The ticket ID to log against (optional)") },
    async ({ ticketId: rawTicketId }) => {
      const ticketId = rawTicketId || "untitled";
      const existing = getActiveSession();
      if (existing) {
        const where = belongsToOtherProject(existing.projectDir)
          ? ` — started in another project (${existing.projectDir})`
          : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `Session already active for ${existing.ticketId}${where}. Run promptly_finish first.`,
            },
          ],
        };
      }

      const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const externalSessionId = process.env.CLAUDE_CODE_SESSION_ID || undefined;
      const projectDir = currentProjectDir();
      writeActiveSession({
        sessionId,
        ticketId,
        startedAt: new Date().toISOString(),
        apiUrl: "http://localhost:3001",
        externalSessionId,
        projectDir,
      });
      const clientTool = getClientToolName(server);
      initBuffer(ticketId, clientTool, externalSessionId, projectDir);
      return {
        content: [
          {
            type: "text" as const,
            text: `🔴 Promptly recording — ${ticketId}. All conversation turns will be logged. Tell the user recording has started (one short line). Finish with promptly_finish when the work wraps up.`,
          },
        ],
      };
    }
  );

  // Tool: Log a conversation turn
  server.tool(
    "promptly_log",
    "Log a conversation turn (called automatically during active session)",
    {
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
      model: z.string().optional(),
      tokenCount: z.number().optional(),
      toolCalls: z.array(z.object({
        name: z.string(),
        input: z.unknown(),
        output: z.unknown().optional(),
        timestamp: z.string().optional(),
      })).optional(),
    },
    async ({ role, content, model, tokenCount, toolCalls }) => {
      const session = getActiveSession();
      const buffer = readBuffer();
      if (!session && !buffer) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No active session. Run promptly_start first.",
            },
          ],
        };
      }

      // Never log this project's turns into a recording that belongs to
      // another project — that would silently pollute its session data.
      const recordingDir = session?.projectDir ?? buffer?.projectDir;
      if (belongsToOtherProject(recordingDir)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Not logged: the active recording (${session?.ticketId ?? buffer?.ticketId}) belongs to another project (${recordingDir}). Finish it there first, or start a session for this project.`,
            },
          ],
        };
      }

      const turn: ConversationTurn = {
        role,
        content,
        timestamp: new Date().toISOString(),
        model,
        tokenCount,
        ...(toolCalls ? { toolCalls: toolCalls.map(tc => ({ name: tc.name, input: tc.input, output: tc.output, timestamp: tc.timestamp ?? new Date().toISOString() })) } : {}),
      };

      addTurn(turn);
      return {
        content: [
          { type: "text" as const, text: "Logged." },
        ],
      };
    }
  );

  // Tool: Check session status
  server.tool(
    "promptly_status",
    "Check the current logging session status",
    {},
    async () => {
      const session = getActiveSession();
      const buffer = readBuffer();

      if (!session && !buffer) {
        return {
          content: [
            { type: "text" as const, text: "No active session." },
          ],
        };
      }

      const ticketId = session?.ticketId ?? buffer?.ticketId ?? "unknown";
      const messageCount = buffer?.messageCount ?? 0;
      const totalTokens = buffer?.totalTokens ?? 0;
      const startedAt = session?.startedAt ?? buffer?.startedAt ?? "";
      const recordingDir = session?.projectDir ?? buffer?.projectDir;

      if (belongsToOtherProject(recordingDir)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `A recording is active for ${ticketId}, but it belongs to another project (${recordingDir}). This project's turns are NOT being logged.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `🔴 Promptly recording — ${ticketId}`,
              `Started: ${startedAt}`,
              `Messages: ${messageCount}`,
              `Tokens: ${totalTokens}`,
            ].join("\n"),
          },
        ],
      };
    }
  );

  // Tool: Finish session and return buffer for upload
  server.tool(
    "promptly_finish",
    "Finish the current logging session",
    {},
    async () => {
      const buffer = readBuffer();
      if (!buffer) {
        return {
          content: [
            { type: "text" as const, text: "No active session to finish." },
          ],
        };
      }

      buffer.finishedAt = new Date().toISOString();
      buffer.status = "COMPLETED";

      // Persist to SQLite before clearing buffer
      const writeResult = writeToSqlite(buffer);
      if (!writeResult.ok) {
        // Keep buffer.json and session.json so the session can be recovered
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to save session to the local database: ${writeResult.error}. The conversation buffer was kept at ~/.promptly/buffer.json — run \`promptly finish\` from the CLI to retry.`,
            },
          ],
        };
      }

      const summary = [
        `⏹ Recording stopped — session saved for ${buffer.ticketId}`,
        `Duration: ${formatDuration(buffer.startedAt, buffer.finishedAt)}`,
        `Messages: ${buffer.messageCount}`,
        `Tokens: ${buffer.totalTokens}`,
      ].join("\n");

      clearBuffer();
      clearActiveSession();

      return {
        content: [{ type: "text" as const, text: summary }],
      };
    }
  );

  return server;
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${remaining}m`;
}
